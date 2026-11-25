import json
import sys
import httpx

# Point to your live Vercel deployment (or switch back to http://localhost:8000/api/v1)
BASE_URL = "https://backend-gamma-ashy-13.vercel.app/api/v1"
FPL_BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/"

# Replace with your actual FPL Entry ID
TEST_TEAM_ID = 1285530
FREE_TRANSFERS = 1


def get_active_gameweek() -> int:
    """Fetches the current or latest started Gameweek from FPL so picks never 404."""
    res = httpx.get(FPL_BOOTSTRAP_URL, timeout=15.0)
    res.raise_for_status()
    events = res.json().get("events", [])
    current = next((e["id"] for e in events if e.get("is_current")), None)
    if current:
        return current
    started = [e["id"] for e in events if e.get("finished") or e.get("data_checked")]
    return max(started, default=1)


def run_tests():
    active_gw = get_active_gameweek()
    with httpx.Client(base_url=BASE_URL, timeout=120.0) as client:
        # 1. Health Check
        print("1. Checking API Health...")
        res = client.get("/health")
        res.raise_for_status()
        print("   -> Health:", res.json())

        # 2. Check Current Model Status
        print("\n2. Checking Model Status...")
        res = client.get("/model")
        model_info = res.json()
        print("   -> Model Status:", model_info)

        # 3. Only trigger /retrain locally (Vercel serverless functions are read-only & time-bounded)
        is_local = "localhost" in BASE_URL or "127.0.0.1" in BASE_URL
        if model_info.get("status") != "ready" and is_local:
            print("\n3. Training Position Ridge Models locally (~20s)...")
            res = client.post("/retrain", json={})
            if res.status_code != 200:
                print("   -> Retrain failed:", res.text)
                sys.exit(1)
            retrain_data = res.json()
            print(f"   -> Trained {retrain_data['model_version']} on {retrain_data['training_sample_count']} samples!")
            for pos, metrics in retrain_data["metrics"].items():
                print(f"      Position {pos}: MAE = {metrics['validation_mae']} ({metrics['sample_count']} samples)")
        elif model_info.get("status") != "ready":
            print("\n3. Remote model is untrained (using deterministic heuristic fallback). Commit model_v1.joblib to deploy weights.")
        else:
            print("\n3. Model artifact loaded and ready!")

        # 4. Test Squad Optimization (MILP + Monte Carlo + Transfer Solver)
        print(f"\n4. Optimizing Squad for Team ID {TEST_TEAM_ID} (GW {active_gw})...")
        payload = {
            "team_id": TEST_TEAM_ID,
            "gameweek": active_gw,
            "free_transfers": FREE_TRANSFERS,
        }
        res = client.post("/optimize-squad", json=payload)
        if res.status_code != 200:
            print(f"   -> Error ({res.status_code}):", json.dumps(res.json(), indent=2))
            return

        data = res.json()
        print("\n   === CAPTAINCY (25,000 Monte Carlo Trials) ===")
        cap = data["captain"]
        vice = data["viceCaptain"]
        print(f"   (C)  {cap['player']['web_name']:<15} | xP: {cap['xP']:<5} | Haul Prob (>=10pts): {cap['haulProbability']}%")
        print(f"   (VC) {vice['player']['web_name']:<15} | xP: {vice['xP']:<5} | Haul Prob (>=10pts): {vice['haulProbability']}%")

        print("\n   === OPTIMAL STARTING XI (SciPy MILP) ===")
        for p in data["starters"]:
            match_str = ", ".join(
                f"{m['opponentShort']}({'H' if m['isHome'] else 'A'})" for m in p["matchups"]
            )
            print(f"   - {p['player']['web_name']:<15} | xP: {p['xP']:<5} | {match_str}")

        print("\n   === PRIORITY BENCH ===")
        for idx, p in enumerate(data["bench"], 1):
            label = "GKP 2" if idx == 4 else f"Sub {idx}"
            print(f"   [{label}] {p['player']['web_name']:<15} | xP: {p['xP']:<5}")

        print("\n   === PRIORITY TRANSFER ===")
        if data["transferSuggestions"]:
            sug = data["transferSuggestions"][0]
            print(
                f"   SELL: {sug['sellCandidate']['player']['web_name']} ({sug['sellCandidate']['xP']} xP) "
                f"---> BUY: {sug['buyCandidate']['web_name']} (+{sug['deltaXP']} net xP gain)"
            )
        else:
            print("   No positive net xP transfer found within budget.")

        # 5. Test 4-GW Recommendations (Midfielders = 3)
        print(f"\n5. Top 5 Recommended Midfielders (GW {active_gw} - {active_gw + 3})...")
        res = client.get("/recommendations", params={"start_gw": active_gw, "position": 3})
        res.raise_for_status()
        recs = res.json()[:5]
        for r in recs:
            print(
                f"   - {r['player']['web_name']:<15} | Score: {r['projectedScore']:<3} "
                f"| 4-GW Model xP: {r['projectedXP']} | Avg FDR: {r['avgFDR']}"
            )


if __name__ == "__main__":
    run_tests()