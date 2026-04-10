/* ==========================================================================
   Options Scanner Engine
   Black-Scholes pricing, Greeks, scoring algorithm, and data layer
   ========================================================================== */

const OptionsEngine = (() => {

    // ── Math Utilities ───────────────────────────────────────────────────

    // Standard normal PDF
    function normalPDF(x) {
        return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    }

    // Standard normal CDF — Abramowitz & Stegun approximation (|error| < 7.5e-8)
    function normalCDF(x) {
        if (x < -10) return 0;
        if (x > 10) return 1;
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
        const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        const t = 1.0 / (1.0 + p * Math.abs(x));
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
        return 0.5 * (1.0 + sign * y);
    }

    // ── Black-Scholes Pricing ────────────────────────────────────────────

    /**
     * Calculate Black-Scholes price and Greeks
     * @param {number} S  - Current stock price
     * @param {number} K  - Strike price
     * @param {number} T  - Time to expiration in years
     * @param {number} r  - Risk-free rate (decimal, e.g. 0.045)
     * @param {number} sigma - Implied volatility (decimal, e.g. 0.30)
     * @param {string} type - 'call' or 'put'
     * @returns {object} { price, delta, gamma, theta, vega, rho }
     */
    function blackScholes(S, K, T, r, sigma, type) {
        if (T <= 0) T = 0.0001; // avoid division by zero
        if (sigma <= 0) sigma = 0.001;

        const sqrtT = Math.sqrt(T);
        const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
        const d2 = d1 - sigma * sqrtT;

        const Nd1 = normalCDF(d1);
        const Nd2 = normalCDF(d2);
        const Nnd1 = normalCDF(-d1);
        const Nnd2 = normalCDF(-d2);
        const nd1 = normalPDF(d1);
        const discount = Math.exp(-r * T);

        let price, delta;

        if (type === 'call') {
            price = S * Nd1 - K * discount * Nd2;
            delta = Nd1;
        } else {
            price = K * discount * Nnd2 - S * Nnd1;
            delta = Nd1 - 1;
        }

        const gamma = nd1 / (S * sigma * sqrtT);
        const vega = S * nd1 * sqrtT / 100; // per 1% move in IV

        let theta;
        if (type === 'call') {
            theta = (-(S * nd1 * sigma) / (2 * sqrtT) - r * K * discount * Nd2) / 365;
        } else {
            theta = (-(S * nd1 * sigma) / (2 * sqrtT) + r * K * discount * Nnd2) / 365;
        }

        let rho;
        if (type === 'call') {
            rho = K * T * discount * Nd2 / 100;
        } else {
            rho = -K * T * discount * Nnd2 / 100;
        }

        return { price: Math.max(price, 0), delta, gamma, theta, vega, rho, d1, d2 };
    }

    // ── Implied Volatility (Newton-Raphson) ──────────────────────────────

    function impliedVolatility(marketPrice, S, K, T, r, type, maxIter = 100) {
        if (marketPrice <= 0) return 0.01;
        let sigma = 0.3; // initial guess

        for (let i = 0; i < maxIter; i++) {
            const bs = blackScholes(S, K, T, r, sigma, type);
            const diff = bs.price - marketPrice;
            const vegaRaw = S * normalPDF(bs.d1) * Math.sqrt(T);

            if (Math.abs(diff) < 0.001) return sigma;
            if (vegaRaw < 0.0001) break; // avoid division by near-zero

            sigma -= diff / vegaRaw;
            if (sigma <= 0.001) sigma = 0.001;
            if (sigma > 5) sigma = 5;
        }
        return sigma;
    }

    // ── Scoring Engine ───────────────────────────────────────────────────

    /**
     * Calculate dynamic scoring weights based on user preferences
     */
    function calculateWeights(riskWillingness, upsideDesire, conviction) {
        // Normalize 1-100 to 0-1
        const risk = riskWillingness / 100;
        const upside = upsideDesire / 100;
        const conv = conviction / 100;

        // Base weights
        let premium = 0.25;
        let safety = 0.25;
        let probability = 0.20;
        let forecast = 0.15;
        let liquidity = 0.10;
        let timeDecay = 0.05;

        // Adjust for risk willingness
        premium += risk * 0.15;
        safety -= risk * 0.12;
        probability -= risk * 0.05;

        // Adjust for upside desire
        premium += upside * 0.10;
        safety -= upside * 0.06;
        timeDecay += upside * 0.05;

        // Adjust for conviction
        forecast += conv * 0.10;
        safety -= conv * 0.05;
        probability -= conv * 0.03;

        // Ensure minimum weights and normalize
        const weights = { premium, safety, probability, forecast, liquidity, timeDecay };
        const keys = Object.keys(weights);

        // Floor at 0.02
        keys.forEach(k => { if (weights[k] < 0.02) weights[k] = 0.02; });

        // Normalize to sum to 1
        const total = keys.reduce((s, k) => s + weights[k], 0);
        keys.forEach(k => { weights[k] /= total; });

        return weights;
    }

    /**
     * Score a single option contract
     */
    function scoreOption(opt, params) {
        const { currentPrice, targetPrice, conviction, riskWillingness, upsideDesire, direction, timelineMonths } = params;
        const weights = calculateWeights(riskWillingness, upsideDesire, conviction);

        const mid = (opt.bid + opt.ask) / 2;
        if (mid <= 0) return { ...opt, score: 0, breakdown: {} };

        const dte = opt.dte;
        const T = dte / 365;

        // 1. Premium Yield Score (annualized)
        const annualizedYield = (mid / opt.strike) * (365 / dte) * 100;
        const premiumScore = Math.min(annualizedYield / 50, 1); // normalize: 50% annual = perfect

        // 2. Safety Margin Score
        let safetyPct;
        if (opt.type === 'put') {
            safetyPct = ((currentPrice - opt.strike) / currentPrice) * 100;
        } else {
            safetyPct = ((opt.strike - currentPrice) / currentPrice) * 100;
        }
        // Out of the money = positive safety. Deeper OTM = safer but less premium.
        const safetyScore = safetyPct > 0 ? Math.min(safetyPct / 25, 1) : 0;

        // 3. Probability of Profit Score
        // For sellers: PoP = 1 - |delta| (approximate)
        const pop = 1 - Math.abs(opt.delta);
        const probScore = pop;

        // 4. Forecast Alignment Score
        let forecastScore = 0;
        if (opt.type === 'put' && direction === 'bullish') {
            // For bullish put selling: strike should be below target
            // Best if strike is at or below target (comfortable assignment price)
            if (opt.strike <= targetPrice) {
                const buffer = (targetPrice - opt.strike) / targetPrice;
                forecastScore = Math.max(0, 1 - buffer * 3); // sweet spot near target
            } else {
                // Strike above target — risky relative to thesis
                forecastScore = Math.max(0, 1 - ((opt.strike - targetPrice) / targetPrice) * 5);
            }
        } else if (opt.type === 'call' && direction === 'bearish') {
            // For bearish call selling: strike should be above target
            if (opt.strike >= targetPrice) {
                const buffer = (opt.strike - targetPrice) / targetPrice;
                forecastScore = Math.max(0, 1 - buffer * 3);
            } else {
                forecastScore = Math.max(0, 1 - ((targetPrice - opt.strike) / targetPrice) * 5);
            }
        } else if (opt.type === 'put' && direction === 'bearish') {
            // Selling puts on bearish view (unusual but possible for income)
            // Prefer deep OTM
            forecastScore = safetyScore * 0.5;
        } else if (opt.type === 'call' && direction === 'bullish') {
            // Selling covered calls — strike above current but may cap upside
            if (opt.strike >= targetPrice) {
                forecastScore = 0.8; // safe, won't get called away before target
            } else {
                forecastScore = Math.max(0, 0.5 - ((targetPrice - opt.strike) / targetPrice) * 3);
            }
        }

        // 5. Liquidity Score
        const volume = opt.volume || 0;
        const openInterest = opt.openInterest || 0;
        const spread = opt.ask - opt.bid;
        const spreadPct = mid > 0 ? spread / mid : 1;

        let liqScore = 0;
        // Volume component (up to 0.4)
        liqScore += Math.min(volume / 500, 1) * 0.3;
        // OI component (up to 0.3)
        liqScore += Math.min(openInterest / 2000, 1) * 0.3;
        // Spread component (up to 0.4) — tighter is better
        liqScore += Math.max(0, 1 - spreadPct * 5) * 0.4;

        // 6. Time Decay Efficiency Score
        // Theta decay accelerates around 30-60 DTE sweet spot
        let timeDecayScore;
        if (dte >= 20 && dte <= 60) {
            timeDecayScore = 1.0; // sweet spot
        } else if (dte > 60 && dte <= 120) {
            timeDecayScore = 0.7;
        } else if (dte > 120) {
            timeDecayScore = Math.max(0.2, 1 - (dte - 60) / 300);
        } else {
            // Very short DTE — fast decay but more gamma risk
            timeDecayScore = Math.max(0.3, dte / 20);
        }

        // DTE alignment with user's timeline
        const timelineDays = timelineMonths * 30;
        const dteRatio = dte / timelineDays;
        // Prefer DTE within 20-80% of timeline
        if (dteRatio >= 0.2 && dteRatio <= 0.8) {
            timeDecayScore *= 1.0;
        } else if (dteRatio > 0.8 && dteRatio <= 1.2) {
            timeDecayScore *= 0.8;
        } else {
            timeDecayScore *= 0.5;
        }
        timeDecayScore = Math.min(timeDecayScore, 1);

        // Composite score
        const score = (
            weights.premium * premiumScore +
            weights.safety * safetyScore +
            weights.probability * probScore +
            weights.forecast * forecastScore +
            weights.liquidity * liqScore +
            weights.timeDecay * timeDecayScore
        ) * 100;

        // Break-even
        const breakeven = opt.type === 'put' ? opt.strike - mid : opt.strike + mid;

        // Max profit / loss per contract
        const maxProfit = mid * 100;
        let maxLoss;
        if (opt.type === 'put') {
            maxLoss = (opt.strike - mid) * 100; // if stock goes to 0
        } else {
            maxLoss = Infinity; // naked call — theoretically unlimited
        }

        return {
            ...opt,
            mid: Math.round(mid * 100) / 100,
            annualizedYield: Math.round(annualizedYield * 100) / 100,
            safetyPct: Math.round(safetyPct * 100) / 100,
            pop: Math.round(pop * 1000) / 10,
            breakeven: Math.round(breakeven * 100) / 100,
            maxProfit: Math.round(maxProfit * 100) / 100,
            maxLoss: maxLoss === Infinity ? 'Unlimited' : Math.round(maxLoss * 100) / 100,
            score: Math.round(score * 100) / 100,
            breakdown: {
                premium: Math.round(premiumScore * 100),
                safety: Math.round(safetyScore * 100),
                probability: Math.round(probScore * 100),
                forecast: Math.round(forecastScore * 100),
                liquidity: Math.round(liqScore * 100),
                timeDecay: Math.round(timeDecayScore * 100)
            },
            weights
        };
    }

    // ── Main Scanner ─────────────────────────────────────────────────────

    /**
     * Scan an options chain and return scored, sorted results
     * @param {Array} chain - Array of option contracts
     * @param {Object} params - Scanner parameters
     * @returns {Array} Sorted scored results
     */
    function scanOptions(chain, params) {
        const { strategy, minDte, maxDte } = params;

        // Filter by strategy type
        let filtered = chain;
        if (strategy === 'sell_puts') {
            filtered = chain.filter(o => o.type === 'put');
        } else if (strategy === 'sell_calls') {
            filtered = chain.filter(o => o.type === 'call');
        }

        // Filter by DTE range
        filtered = filtered.filter(o => o.dte >= minDte && o.dte <= maxDte);

        // Filter out options with no bid (unmarketable)
        filtered = filtered.filter(o => o.bid > 0);

        // Score each option
        const scored = filtered.map(o => scoreOption(o, params));

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        return scored;
    }

    // ── Data Fetching ────────────────────────────────────────────────────

    /**
     * Attempt to fetch live options chain from Yahoo Finance
     */
    async function fetchLiveData(ticker) {
        const baseUrl = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}`;
        const proxies = [
            url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
            url => url // direct (may work in some contexts)
        ];

        for (const proxy of proxies) {
            try {
                // First fetch to get list of expirations
                const initUrl = proxy(baseUrl);
                const initResp = await fetch(initUrl, { signal: AbortSignal.timeout(8000) });
                if (!initResp.ok) continue;

                const initData = await initResp.json();
                const result = initData.optionChain?.result?.[0];
                if (!result) continue;

                const quote = result.quote;
                const currentPrice = quote?.regularMarketPrice;
                const expirationDates = result.expirationDates || [];

                if (!currentPrice || expirationDates.length === 0) continue;

                // Fetch all expirations
                const allOptions = [];

                // Process the first expiration from the initial response
                if (result.options?.[0]) {
                    const exp = result.options[0];
                    allOptions.push(...parseYahooExpiration(exp, currentPrice));
                }

                // Fetch remaining expirations (limit to 12 to avoid rate limits)
                const remaining = expirationDates.slice(1, 12);
                const fetchPromises = remaining.map(async (expDate) => {
                    try {
                        const url = proxy(`${baseUrl}?date=${expDate}`);
                        const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
                        if (!resp.ok) return [];
                        const data = await resp.json();
                        const r = data.optionChain?.result?.[0];
                        if (!r?.options?.[0]) return [];
                        return parseYahooExpiration(r.options[0], currentPrice);
                    } catch {
                        return [];
                    }
                });

                const results = await Promise.allSettled(fetchPromises);
                results.forEach(r => {
                    if (r.status === 'fulfilled') allOptions.push(...r.value);
                });

                if (allOptions.length > 0) {
                    return {
                        source: 'Yahoo Finance (Live)',
                        currentPrice,
                        companyName: quote.shortName || quote.longName || ticker.toUpperCase(),
                        chain: allOptions
                    };
                }
            } catch {
                continue;
            }
        }

        return null; // all proxies failed
    }

    function parseYahooExpiration(expData, currentPrice) {
        const options = [];
        const now = Date.now() / 1000;

        const process = (contracts, type) => {
            if (!contracts) return;
            contracts.forEach(c => {
                const expDate = new Date(c.expiration * 1000);
                const dte = Math.max(1, Math.round((c.expiration - now) / 86400));

                options.push({
                    type,
                    strike: c.strike,
                    bid: c.bid || 0,
                    ask: c.ask || 0,
                    lastPrice: c.lastPrice || 0,
                    volume: c.volume || 0,
                    openInterest: c.openInterest || 0,
                    iv: c.impliedVolatility || 0,
                    dte,
                    expiry: expDate.toISOString().split('T')[0],
                    inTheMoney: c.inTheMoney || false,
                    contractSymbol: c.contractSymbol || '',
                    delta: 0, gamma: 0, theta: 0, vega: 0 // will be calculated
                });
            });
        };

        process(expData.calls, 'call');
        process(expData.puts, 'put');
        return options;
    }

    // ── Simulated Data Generation ────────────────────────────────────────

    /**
     * Generate realistic simulated options chain using Black-Scholes
     */
    function generateSimulatedData(ticker, currentPrice, r = 0.045) {
        const chain = [];
        const baseIV = 0.25 + Math.random() * 0.15; // 25-40% base IV

        // Generate expirations: weekly for first 2 months, monthly out to 18 months
        const expirations = [];
        const today = new Date();

        // Weekly for next 8 weeks
        for (let w = 1; w <= 8; w++) {
            const d = new Date(today);
            d.setDate(d.getDate() + w * 7);
            // Adjust to Friday
            const day = d.getDay();
            const diff = (5 - day + 7) % 7;
            d.setDate(d.getDate() + diff);
            expirations.push(d);
        }

        // Monthly for months 3-18
        for (let m = 3; m <= 18; m++) {
            const d = new Date(today.getFullYear(), today.getMonth() + m, 1);
            // Third Friday of month
            const firstDay = d.getDay();
            let thirdFriday = 15 + ((5 - firstDay + 7) % 7);
            if (thirdFriday > 21) thirdFriday -= 7;
            d.setDate(thirdFriday);
            expirations.push(d);
        }

        expirations.forEach(expDate => {
            const dte = Math.max(1, Math.round((expDate - today) / 86400000));
            const T = dte / 365;
            const expStr = expDate.toISOString().split('T')[0];

            // IV term structure: slightly higher for shorter and longer dated
            let ivAdj = baseIV;
            if (dte < 30) ivAdj *= (1.1 + (30 - dte) * 0.005);
            else if (dte > 180) ivAdj *= (1.05 + (dte - 180) * 0.0005);

            // Generate strikes: from -30% to +30% of current price
            const minStrike = Math.floor(currentPrice * 0.7);
            const maxStrike = Math.ceil(currentPrice * 1.3);

            // Determine strike step based on price
            let step;
            if (currentPrice < 25) step = 0.5;
            else if (currentPrice < 50) step = 1;
            else if (currentPrice < 200) step = 2.5;
            else if (currentPrice < 500) step = 5;
            else step = 10;

            for (let K = minStrike; K <= maxStrike; K += step) {
                const strike = Math.round(K * 100) / 100;

                // IV smile: higher IV for OTM options
                const moneyness = Math.abs(Math.log(currentPrice / strike));
                const iv = ivAdj * (1 + moneyness * 1.5);

                ['call', 'put'].forEach(type => {
                    const bs = blackScholes(currentPrice, strike, T, r, iv, type);

                    // Skip options worth less than $0.01
                    if (bs.price < 0.01) return;

                    // Simulate bid/ask spread (tighter for ATM, wider for OTM)
                    const spreadFactor = 0.02 + moneyness * 0.08;
                    const halfSpread = bs.price * spreadFactor;
                    const bid = Math.max(0.01, Math.round((bs.price - halfSpread) * 100) / 100);
                    const ask = Math.round((bs.price + halfSpread) * 100) / 100;

                    // Simulate volume and OI (higher for ATM, recent expirations)
                    const atmFactor = Math.exp(-moneyness * moneyness * 20);
                    const timeFactor = Math.exp(-dte / 200);
                    const baseVol = 50 + Math.random() * 200;
                    const volume = Math.round(baseVol * atmFactor * timeFactor * (0.5 + Math.random()));
                    const openInterest = Math.round(volume * (3 + Math.random() * 10));

                    chain.push({
                        type,
                        strike,
                        bid,
                        ask,
                        lastPrice: Math.round(bs.price * 100) / 100,
                        volume,
                        openInterest,
                        iv: Math.round(iv * 10000) / 10000,
                        dte,
                        expiry: expStr,
                        inTheMoney: type === 'call' ? strike < currentPrice : strike > currentPrice,
                        contractSymbol: `${ticker.toUpperCase()}${expStr.replace(/-/g, '')}${type === 'call' ? 'C' : 'P'}${(strike * 1000).toFixed(0).padStart(8, '0')}`,
                        delta: Math.round(bs.delta * 10000) / 10000,
                        gamma: Math.round(bs.gamma * 10000) / 10000,
                        theta: Math.round(bs.theta * 10000) / 10000,
                        vega: Math.round(bs.vega * 10000) / 10000
                    });
                });
            }
        });

        return chain;
    }

    /**
     * Enrich options with calculated Greeks (for live data missing Greeks)
     */
    function enrichGreeks(chain, currentPrice, r = 0.045) {
        return chain.map(opt => {
            if (opt.delta !== 0 && opt.gamma !== 0) return opt; // already has Greeks

            const T = opt.dte / 365;
            const mid = (opt.bid + opt.ask) / 2;

            // Calculate IV from market price if not provided
            let iv = opt.iv;
            if (!iv || iv === 0) {
                iv = impliedVolatility(mid, currentPrice, opt.strike, T, r, opt.type);
            }

            const bs = blackScholes(currentPrice, opt.strike, T, r, iv, opt.type);

            return {
                ...opt,
                iv: Math.round(iv * 10000) / 10000,
                delta: Math.round(bs.delta * 10000) / 10000,
                gamma: Math.round(bs.gamma * 10000) / 10000,
                theta: Math.round(bs.theta * 10000) / 10000,
                vega: Math.round(bs.vega * 10000) / 10000
            };
        });
    }

    // ── Demo Ticker Prices ───────────────────────────────────────────────

    const DEMO_PRICES = {
        AAPL: { price: 198.50, name: 'Apple Inc.' },
        MSFT: { price: 425.30, name: 'Microsoft Corporation' },
        GOOGL: { price: 178.90, name: 'Alphabet Inc.' },
        AMZN: { price: 195.20, name: 'Amazon.com Inc.' },
        TSLA: { price: 245.80, name: 'Tesla Inc.' },
        NVDA: { price: 890.50, name: 'NVIDIA Corporation' },
        META: { price: 515.40, name: 'Meta Platforms Inc.' },
        SPY: { price: 528.70, name: 'SPDR S&P 500 ETF' },
        QQQ: { price: 452.10, name: 'Invesco QQQ Trust' },
        AMD: { price: 172.30, name: 'Advanced Micro Devices' },
        NFLX: { price: 628.90, name: 'Netflix Inc.' },
        DIS: { price: 112.40, name: 'The Walt Disney Company' },
        BA: { price: 188.60, name: 'The Boeing Company' },
        JPM: { price: 198.70, name: 'JPMorgan Chase & Co.' },
        V: { price: 282.40, name: 'Visa Inc.' },
        WMT: { price: 165.80, name: 'Walmart Inc.' },
        COIN: { price: 225.60, name: 'Coinbase Global Inc.' },
        PLTR: { price: 24.80, name: 'Palantir Technologies' },
        SOFI: { price: 8.90, name: 'SoFi Technologies' },
        NIO: { price: 5.40, name: 'NIO Inc.' }
    };

    // ── Public API ───────────────────────────────────────────────────────

    return {
        blackScholes,
        impliedVolatility,
        normalCDF,
        normalPDF,
        calculateWeights,
        scoreOption,
        scanOptions,
        fetchLiveData,
        generateSimulatedData,
        enrichGreeks,
        DEMO_PRICES
    };

})();
