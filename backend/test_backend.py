import json
import sys
import httpx

BASE_URL = "http://localhost:8000/api/v1"

# Replace with your actual FPL Entry ID and the upcoming/current Gameweek
TEST_TEAM_ID = 1285530
TEST_GAMEWEEK = 10
FREE_TRANSFERS = 1


def run_tests():
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

        # 3. Train / Retrain Ridge Regression Models if Untrained
        if model_info.get("status") != "ready":
            print("\n3. Training Position Ridge Models (fetching FPL player histories, ~20s)...")
            res = client.post("/retrain", json={})
            if res.status_code != 200:
                print("   -> Retrain failed:", res.text)
                sys.exit(1)
            retrain_data = res.json()
            print(f"   -> Trained {retrain_data['model_version']} on {retrain_data['training_sample_count']} samples!")
            for pos, metrics in retrain_data["metrics"].items():
                print(f"      Position {pos}: MAE = {metrics['validation_mae']} ({metrics['sample_count']} samples)")
        else:
            print("\n3. Model already trained and ready!")

        # 4. Test Squad Optimization (MILP + Monte Carlo + Transfer Solver)
        print(f"\n4. Optimizing Squad for Team ID {TEST_TEAM_ID} (GW {TEST_GAMEWEEK})...")
        payload = {
            "team_id": TEST_TEAM_ID,
            "gameweek": TEST_GAMEWEEK,
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
        print(f"\n5. Top 5 Recommended Midfielders (GW {TEST_GAMEWEEK} - {TEST_GAMEWEEK + 3})...")
        res = client.get("/recommendations", params={"start_gw": TEST_GAMEWEEK, "position": 3})
        res.raise_for_status()
        recs = res.json()[:5]
        for r in recs:
            print(
                f"   - {r['player']['web_name']:<15} | Score: {r['projectedScore']:<3} "
                f"| 4-GW Model xP: {r['projectedXP']} | Avg FDR: {r['avgFDR']}"
            )


if __name__ == "__main__":
    run_tests()