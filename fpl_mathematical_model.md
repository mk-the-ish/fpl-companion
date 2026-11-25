# Mathematical Formulation & Decision Architecture

The algorithmic engine behind **FPL Companion** transitions fantasy sports management from speculative intuition to a deterministic operational research problem. Rather than relying on lagging trailing averages, the system models fantasy outcomes through a hierarchical pipeline:

```
[ Raw Underlying Metrics ] ──▶ [ Empirical Bayesian Shrinkage ]
                                          │
                                          ▼
[ Fixture Schedule & Context ] ──▶ [ Time-Decayed Concurrency Model ]
                                          │
                                          ▼
                         [ Blank & Double GW Fixture Expander ]
                                          │
                                          ▼
                               [ Expected Value Engine (xP) ]
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
     [ 0-1 Integer Linear Program ]                   [ Monte Carlo Simulation ]
      Knapsack Formation Optimizer                     Compound Poisson Variance
      (Starters, Bench Order & Transfers)             (Captaincy Haul Probability)

```

## 1. Underlying Rate Regression & Mean Shrinkage

Raw point totals introduce severe variance caused by flukey deflections, small sample noise, and irregular penalties. The engine isolates predictive underlying metrics per 90 minutes:

$$
\text{xGI}_{90} = \frac{\text{npxG} + \text{xA}}{\text{Minutes Played}} \times 90
$$

Where:

* $\text{npxG}$: Non-penalty expected goals.

* $\text{xA}$: Expected assists.

To prevent overreacting to short-term variance (such as a bench asset scoring on consecutive cameos), an empirical Bayesian shrinkage operator regresses an asset's short-term rolling rate ($\text{xGI}_{\text{recent}}$) back toward their long-term positional baseline ($\text{xGI}_{\text{prior}}$):

$$
\widehat{\text{xGI}} = \alpha \cdot \text{xGI}_{\text{recent}} + (1 - \alpha) \cdot \text{xGI}_{\text{prior}}
$$

The shrinkage coefficient $\alpha \in [0, 1]$ is parameterized as a logistic saturation function of minutes played ($M$) over the observation window:

$$
\alpha(M) = \frac{1}{1 + \exp\left(-\kappa (M - M_0)\right)}
$$

* $\kappa$: Steepness parameter governing sample confidence.

* $M_0$: Inflection threshold (calibrated to $450$ minutes, or five full matches).

### Positional Deflection for Defensive Assets

For goalkeepers and defenders, attacking threat is deprioritized in favor of clean sheet retention and baseline shot-stopping:

$$
\text{P}(\text{CS}) = \exp\left(-\beta \cdot \text{xGC}_{90}^{\text{opponent}}\right)
$$

$$
\text{Baseline}_{\text{GKP/DEF}} = 2.0 + 4.0 \cdot \text{P}(\text{CS}) + \min\left(1.5, \frac{\text{Saves}}{3} \times 0.33\right)
$$

## 2. Dynamic Fixture Concurrency: Blank & Double Gameweek Modeling

Real-world Premier League schedules deviate from 1 match per gameweek due to domestic cup clashes, weather postponements, and international commitments. This creates **Blank Gameweeks (BGW)** where clubs play $0$ matches, and **Double Gameweeks (DGW)** where clubs play $2$ matches within the same scoring cycle.

### Mathematical Fixture Expansion

Let $\mathcal{F}_{i, t}$ represent the set of individual matches scheduled for player $i$ in Gameweek $t$:

$$
\vert{}\mathcal{F}_{i, t}\vert{} = \begin{cases} 0, & \text{Blank Gameweek (BGW)} \\  1, & \text{Single Gameweek (SGW)} \\  2, & \text{Double Gameweek (DGW)} \end{cases}
$$

The projected expected points for player $i$ across Gameweek $t$ is computed as the sum of match-level expectations modulated by non-linear fatigue and rotation penalties:

$$
\text{xP}_{i, t} = \sum_{m \in \mathcal{F}_{i, t}} \mathbb{E}\left[\text{Points}_{i, m}\right] \cdot \Phi_{\text{fatigue}}(\vert{}\mathcal{F}_{i, t}\vert{}, \Delta \tau_m) \cdot P(\text{Start}_{i, m})
$$

### 1. Zero-Weight Blank Gameweek Collapse

When $\vert{}\mathcal{F}_{i, t}\vert{} = 0$:

$$
\text{xP}_{i, t} = 0
$$

Assets with BGW entries automatically yield an objective coefficient of zero, forcing the Integer Linear Program to relegate them to the bench or flag them as high-priority sell candidates.

### 2. Double Gameweek Diminishing Multiplier (Fatigue & Sub-90 Decay)

In a DGW, naive arithmetic assumes points simply double ($\text{xP}_{\text{DGW}} \approx 2 \times \text{xP}_{\text{SGW}}$). However, congested schedules ($\Delta \tau \le 72\text{ hours}$) produce rotation risk, early substitutions, and muscular fatigue.

The DGW scalar is parameterized by a non-linear decay function:

$$
\Phi_{\text{fatigue}}(\vert{}\mathcal{F}_{i, t}\vert{}, \Delta \tau_m) = \begin{cases} 1.0, & \vert{}\mathcal{F}_{i, t}\vert{} = 1 \\  \left(1 - \xi \cdot e^{-\lambda \Delta \tau_m}\right), & \vert{}\mathcal{F}_{i, t}\vert{} = 2 \end{cases}
$$

* $\Delta \tau_m$: Rest interval in hours between consecutive kickoffs.

* $\xi \in [0.15, 0.28]$: Empirical fatigue coefficient calibrated by player age and positional physical load (wing-backs and box-to-box midfielders suffer highest decay).

Thus, realistic Double Gameweek expectations scale between $1.65\times$ **and** $1.85\times$ rather than a flat $2.0\times$:

$$
\text{xP}_{i, t}^{\text{DGW}} \approx \text{xP}_{i, m_1} + \left(0.78 \cdot \text{xP}_{i, m_2}\right)
$$

## 3. Multi-Gameweek Fixture Horizon Run Score

Evaluating transfer candidates across a 4-Gameweek horizon $H = 4$ aggregates total scheduled fixtures while discounting future gameweeks via hyperbolic time-decay:

$$
\text{RunScore}_i = \sum_{t=1}^{H} \omega_t \left[ \sum_{m \in \mathcal{F}_{i, t}} \left( (5 - \text{FDR}_{m}) + \delta_{\text{venue}, m} \right) \right]
$$

### Parameters:

* $H = 4$: Planning horizon in gameweeks.

* $\text{FDR}_m \in [1, 5]$: Official Premier League Fixture Difficulty Rating for match $m$.

* $\delta_{\text{venue}, m} \in \{0, 0.75\}$: Home venue advantage boost.

* $\omega_t$: Hyperbolic decay coefficient:

$$
\omega_t = \frac{1}{\sqrt{t}}
$$

If an asset has a DGW in Gameweek $2$ and a BGW in Gameweek $3$, the internal inner summation automatically reflects $2$ matches at $t=2$ and $0$ matches at $t=3$.

## 4. Formation Optimizer: 0-1 Integer Linear Program (Knapsack)

Selecting the starting XI and bench hierarchy from a manager's 15-man squad is formulated as a bounded 0-1 Integer Linear Program (ILP).

Let binary decision variable $x_i \in \{0, 1\}$ denote whether squad member $i$ is selected in the Starting XI ($x_i = 1$) or relegated to the bench ($x_i = 0$):

$$
\max_{\mathbf{x}} \sum_{i=1}^{15} x_i \cdot \text{xP}_i
$$

### Subject to Roster & Formation Constraints:

$$
\begin{aligned} \sum_{i=1}^{15} x_i &= 11 && \text{(Starting Lineup Size)} \\ \sum_{i \in \mathcal{S}_{\text{GKP}}} x_i &= 1 && \text{(Exactly 1 Goalkeeper)} \\ \sum_{i \in \mathcal{S}_{\text{DEF}}} x_i &\ge 3 && \text{(Minimum 3 Defenders)} \\ \sum_{i \in \mathcal{S}_{\text{MID}}} x_i &\ge 2 && \text{(Minimum 2 Midfielders)} \\ \sum_{i \in \mathcal{S}_{\text{FWD}}} x_i &\ge 1 && \text{(Minimum 1 Forward)} \end{aligned}
$$

### BGW/DGW Impact on Roster Selection

Because $\text{xP}_i = 0$ for blank gameweek assets, the objective function $\sum x_i \cdot \text{xP}_i$ drives $x_i \to 0$ for BGW players naturally, unless bench replacements are also blanking. Conversely, DGW players with elevated $\text{xP}_i$ values are systematically favored into the starting XI.

### Bench Hierarchy Assignment

For the remaining 4 players where $x_i = 0$:

1. The reserve goalkeeper ($i \in \mathcal{S}_{\text{GKP}}$) is statically assigned to **Bench Slot 4** (`GKP 2`).

2. The remaining 3 outfield assets are ordered by descending expected points to establish auto-substitution priority:

$$
S_1 \ge S_2 \ge S_3 \quad \forall i \in \{j \mid x_j = 0, j \notin \mathcal{S}_{\text{GKP}}\}
$$

## 5. Monte Carlo Captaincy Simulation for DGW Assets

Captaincy selection in Double Gameweeks requires compound Poisson simulations across **two discrete independent match distributions** per iteration.

For each simulation iteration $j \in [1, N]$ ($N = 10,000$):

$$
\text{SimScore}_{i, j} = \sum_{m \in \mathcal{F}_{i, t}} \mathcal{G}\left(K_{m, j}, \text{Min}_{m}\right)
$$

Where:

* $K_{m, j} \sim \text{Poisson}(\lambda_{i, m})$: Number of attacking events sampled in match $m$.

* $\mathcal{G}(\cdot)$: Point-mapping projection function including position bonus, clean sheet status, and appearance points.

### DGW Haul Probability ($P_{\text{Haul}}$)

Because two matches allow two independent opportunities to achieve double-digit returns:

$$
P_{\text{Haul}}^{\text{DGW}} = \frac{1}{N} \sum_{j=1}^{N} \mathbb{I}\left( \text{SimScore}_{i, j}^{(m_1)} + \text{SimScore}_{i, j}^{(m_2)} \ge 10 \right)
$$

This compound right-tail density explains why mid-tier Double Gameweek assets often surpass elite Single Gameweek premiums in both baseline expectation and captaincy confidence:

$$
\text{Index}_{\text{Captain}} = 1.5 \cdot \text{xP}_i + 0.1 \cdot P_{\text{Haul}}
$$

## 6. Budget-Constrained Multi-Period Transfer Frontier

To solve multi-gameweek transfers accounting for upcoming BGWs and DGWs, the solver evaluates path trajectory over a planning horizon $T \in [1, 4]$:

$$
\max_{\mathbf{u}} \sum_{t=1}^{T} \gamma^{t-1} \left( \sum_{i=1}^{15} x_{i, t} \cdot \text{xP}_{i, t} - 4 \cdot \max(0, \vert{}\mathbf{u}_t\vert{} - 1) \right)
$$

### Constraints:

* $\mathbf{u}_t$: Vector of transfer in/out actions executed at Gameweek $t$.

* $\max(0, \vert{}\mathbf{u}_t\vert{} - 1)$: Points deduction (-4 per extra transfer beyond free allotment).

* $\sum_{i \in \mathcal{S}_t} \text{Cost}_i \le \text{TeamValue}_t + \text{Bank}_t$ (Financial feasibility).

* $\sum_{i \in \text{Club}_c} y_{i, t} \le 3 \quad \forall c \in \text{Clubs}$ (Maximum 3 players per Premier League team).