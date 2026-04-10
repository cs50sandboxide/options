(function () {
    'use strict';
    const state = { ticker: '', currentPrice: 0, companyName: '', direction: 'bullish', strategy: 'sell_puts', targetPrice: 0, timeline: 6, conviction: 70, currentHolding: 0, desiredHolding: 100, maxContracts: 1, riskWillingness: 50, upsideDesire: 50, minDte: 7, maxDte: 180, riskFreeRate: 4.5, results: [], sortKey: 'score', sortDir: 'desc', filterType: 'all', resultLimit: 50, dataSource: '' };
    const $ = id => document.getElementById(id);
    const dom = { loader: $('pageLoader'), nav: $('nav'), mobileMenuBtn: $('mobileMenuBtn'), mobileMenu: $('mobileMenu'), ticker: $('ticker'), fetchBtn: $('fetchBtn'), tickerInfo: $('tickerInfo'), currentPrice: $('currentPrice'), directionToggle: $('directionToggle'), strategyToggle: $('strategyToggle'), targetPrice: $('targetPrice'), timeline: $('timeline'), conviction: $('conviction'), currentHolding: $('currentHolding'), desiredHolding: $('desiredHolding'), maxContracts: $('maxContracts'), riskWillingness: $('riskWillingness'), upsideDesire: $('upsideDesire'), minDte: $('minDte'), maxDte: $('maxDte'), riskFreeRate: $('riskFreeRate'), scanBtn: $('scanBtn'), resultsSection: $('results'), resultsBody: $('resultsBody'), topPick: $('topPick'), topPickTitle: $('topPickTitle'), topPickStats: $('topPickStats'), topPickRationale: $('topPickRationale'), rowDetail: $('rowDetail'), detailGrid: $('detailGrid'), detailClose: $('detailClose'), filterType: $('filterType'), resultLimit: $('resultLimit'), sumTicker: $('sumTicker'), sumDirection: $('sumDirection'), sumStrategy: $('sumStrategy'), sumPrice: $('sumPrice'), sumTarget: $('sumTarget'), sumMove: $('sumMove'), sumTimeline: $('sumTimeline'), sumConviction: $('sumConviction'), sumRisk: $('sumRisk'), sumCapital: $('sumCapital'), wPremium: $('wPremium'), wSafety: $('wSafety'), wProb: $('wProb'), wForecast: $('wForecast'), wLiquidity: $('wLiquidity'), resScanned: $('resScanned'), resBestScore: $('resBestScore'), resBestYield: $('resBestYield'), resAvgPop: $('resAvgPop'), resDataSource: $('resDataSource') };
    function init() {
        window.addEventListener('load', () => {
            setTimeout(() => dom.loader.classList.add('hidden'), 600);
        });
        window.addEventListener('scroll', () => {
            dom.nav.classList.toggle('scrolled', window.scrollY > 40);
        });
        dom.mobileMenuBtn.addEventListener('click', toggleMobileMenu);
        document.querySelectorAll('.mobile-menu-link').forEach(link => {
            link.addEventListener('click', () => toggleMobileMenu(false));
        });
        document.querySelectorAll('a[href^="#"]').forEach(a => {
            a.addEventListener('click', e => {
                e.preventDefault();
                const target = document.querySelector(a.getAttribute('href'));
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
        setupToggleGroup(dom.directionToggle, val => {
            state.direction = val;
            if (val === 'bullish') setToggleValue(dom.strategyToggle, 'sell_puts');
            else setToggleValue(dom.strategyToggle, 'sell_calls');
            updateSummary();
        });
        setupToggleGroup(dom.strategyToggle, val => {
            state.strategy = val;
            updateSummary();
        });
        setupToggleGroup(dom.filterType, val => {
            state.filterType = val;
            renderResults();
        });
        setupSlider(dom.timeline, 'timelineLabel', v => `${v} month${v > 1 ? 's' : ''}`, v => { state.timeline = +v; updateSummary(); });
        setupSlider(dom.conviction, 'convictionLabel', v => `${v}%`, v => { state.conviction = +v; updateSummary(); updateWeightBars(); });
        setupSlider(dom.riskWillingness, 'riskLabel', v => `${v}%`, v => { state.riskWillingness = +v; updateSummary(); updateWeightBars(); });
        setupSlider(dom.upsideDesire, 'upsideLabel', v => `${v}%`, v => { state.upsideDesire = +v; updateSummary(); updateWeightBars(); });
        setupSlider(dom.minDte, 'minDteLabel', v => `${v} days`, v => { state.minDte = +v; });
        setupSlider(dom.maxDte, 'maxDteLabel', v => `${v} days`, v => { state.maxDte = +v; });
        setupSlider(dom.riskFreeRate, 'rateLabel', v => `${v}%`, v => { state.riskFreeRate = +v; });
        dom.ticker.addEventListener('input', () => {
            state.ticker = dom.ticker.value.toUpperCase().trim();
            updateSummary();
        });
        dom.ticker.addEventListener('keydown', e => {
            if (e.key === 'Enter') fetchPrice();
        });
        dom.currentPrice.addEventListener('input', () => {
            state.currentPrice = parseFloat(dom.currentPrice.value) || 0;
            updateSummary();
        });
        dom.targetPrice.addEventListener('input', () => {
            state.targetPrice = parseFloat(dom.targetPrice.value) || 0;
            updateSummary();
        });
        dom.currentHolding.addEventListener('input', () => {
            state.currentHolding = parseInt(dom.currentHolding.value) || 0;
            updateSummary();
        });
        dom.desiredHolding.addEventListener('input', () => {
            state.desiredHolding = parseInt(dom.desiredHolding.value) || 0;
            updateSummary();
        });
        dom.maxContracts.addEventListener('input', () => {
            state.maxContracts = parseInt(dom.maxContracts.value) || 1;
        });
        dom.fetchBtn.addEventListener('click', fetchPrice);
        dom.scanBtn.addEventListener('click', runScan);
        dom.resultLimit.addEventListener('change', () => {
            state.resultLimit = dom.resultLimit.value === 'all' ? Infinity : parseInt(dom.resultLimit.value);
            renderResults();
        });
        dom.detailClose.addEventListener('click', () => {
            dom.rowDetail.style.display = 'none';
        });
        document.querySelectorAll('.results-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.dataset.sort;
                if (state.sortKey === key) {
                    state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
                } else {
                    state.sortKey = key;
                    state.sortDir = 'desc';
                }
                updateSortIndicators();
                renderResults();
            });
        });
        updateWeightBars();
        updateSummary();
    }
    function setupToggleGroup(container, onChange) {
        container.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                onChange(btn.dataset.value);
            });
        });
    }
    function setToggleValue(container, value) {
        container.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === value);
        });
        state.strategy = value;
    }
    function setupSlider(slider, labelId, format, onChange) {
        const label = $(labelId);
        const update = () => {
            label.textContent = format(slider.value);
            onChange(slider.value);
        };
        slider.addEventListener('input', update);
        update();
    }
    function toggleMobileMenu(forceClose) {
        const isActive = forceClose === false ? true : dom.mobileMenu.classList.contains('active');
        dom.mobileMenu.classList.toggle('active', !isActive);
        dom.mobileMenuBtn.classList.toggle('active', !isActive);
    }
    async function fetchPrice() {
        const ticker = state.ticker;
        if (!ticker) {
            showTickerInfo('Enter a ticker symbol', 'error');
            return;
        }
        showTickerInfo('Fetching price...', '');
        dom.fetchBtn.style.pointerEvents = 'none';
        const demo = OptionsEngine.DEMO_PRICES[ticker];
        if (demo) {
            state.currentPrice = demo.price;
            state.companyName = demo.name;
            dom.currentPrice.value = demo.price;
            showTickerInfo(`${demo.name} — $${demo.price.toFixed(2)}`, 'success');
            dom.fetchBtn.style.pointerEvents = '';
            updateSummary();
            return;
        }
        try {
            const data = await OptionsEngine.fetchLiveData(ticker);
            if (data) {
                state.currentPrice = data.currentPrice;
                state.companyName = data.companyName;
                dom.currentPrice.value = data.currentPrice;
                showTickerInfo(`${data.companyName} — $${data.currentPrice.toFixed(2)} (Live)`, 'success');
            } else {
                showTickerInfo('Could not fetch live data. Enter price manually or use a known ticker (AAPL, TSLA, NVDA, etc.)', 'error');
            }
        } catch {
            showTickerInfo('Network error. Enter price manually.', 'error');
        }
        dom.fetchBtn.style.pointerEvents = '';
        updateSummary();
    }
    function showTickerInfo(text, className) {
        dom.tickerInfo.textContent = text;
        dom.tickerInfo.className = 'ticker-info' + (className ? ` ${className}` : '');
    }
    function updateSummary() {
        dom.sumTicker.textContent = state.ticker || '—';
        dom.sumDirection.textContent = state.direction === 'bullish' ? 'Bullish' : 'Bearish';
        dom.sumDirection.className = `summary-stat-value ${state.direction === 'bullish' ? 'positive' : 'negative'}`;
        const stratLabels = { sell_puts: 'Sell Puts', sell_calls: 'Sell Calls', both: 'Both' };
        dom.sumStrategy.textContent = stratLabels[state.strategy] || state.strategy;
        dom.sumPrice.textContent = state.currentPrice ? `$${state.currentPrice.toFixed(2)}` : '—';
        dom.sumTarget.textContent = state.targetPrice ? `$${state.targetPrice.toFixed(2)}` : '—';
        if (state.currentPrice && state.targetPrice) {
            const pctMove = ((state.targetPrice - state.currentPrice) / state.currentPrice * 100).toFixed(1);
            const sign = pctMove >= 0 ? '+' : '';
            dom.sumMove.textContent = `${sign}${pctMove}%`;
            dom.sumMove.className = `summary-stat-value ${pctMove >= 0 ? 'positive' : 'negative'}`;
        } else {
            dom.sumMove.textContent = '—';
            dom.sumMove.className = 'summary-stat-value';
        }
        dom.sumTimeline.textContent = `${state.timeline} month${state.timeline > 1 ? 's' : ''}`;
        dom.sumConviction.textContent = `${state.conviction}%`;
        const riskLabels = ['Conservative', 'Moderate', 'Aggressive'];
        dom.sumRisk.textContent = riskLabels[Math.min(2, Math.floor(state.riskWillingness / 34))];
        if (state.currentPrice && state.desiredHolding) {
            const capital = state.currentPrice * state.desiredHolding;
            dom.sumCapital.textContent = `$${capital.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        } else {
            dom.sumCapital.textContent = '—';
        }
    }
    function updateWeightBars() {
        const w = OptionsEngine.calculateWeights(state.riskWillingness, state.upsideDesire, state.conviction);
        dom.wPremium.style.width = `${w.premium * 100}%`;
        dom.wSafety.style.width = `${w.safety * 100}%`;
        dom.wProb.style.width = `${w.probability * 100}%`;
        dom.wForecast.style.width = `${w.forecast * 100}%`;
        dom.wLiquidity.style.width = `${w.liquidity * 100}%`;
    }
    async function runScan() {
        if (!state.ticker) {
            showTickerInfo('Please enter a ticker symbol', 'error');
            return;
        }
        if (!state.currentPrice || state.currentPrice <= 0) {
            showTickerInfo('Please enter or fetch the current price', 'error');
            return;
        }
        if (!state.targetPrice || state.targetPrice <= 0) {
            dom.targetPrice.focus();
            return;
        }
        dom.scanBtn.disabled = true;
        dom.scanBtn.querySelector('.scan-btn-text').style.display = 'none';
        dom.scanBtn.querySelector('.scan-btn-loading').style.display = 'inline-flex';
        try {
            let chain = null;
            let dataSource = '';
            try {
                const liveData = await OptionsEngine.fetchLiveData(state.ticker);
                if (liveData && liveData.chain.length > 0) {
                    chain = liveData.chain;
                    dataSource = 'Yahoo Finance (Live)';
                    if (liveData.currentPrice) {
                        state.currentPrice = liveData.currentPrice;
                        dom.currentPrice.value = liveData.currentPrice;
                        updateSummary();
                    }
                }
            } catch {
            }
            if (!chain) {
                const r = state.riskFreeRate / 100;
                chain = OptionsEngine.generateSimulatedData(state.ticker, state.currentPrice, r);
                dataSource = 'Simulated (Black-Scholes)';
            }
            const r = state.riskFreeRate / 100;
            chain = OptionsEngine.enrichGreeks(chain, state.currentPrice, r);
            const params = { currentPrice: state.currentPrice, targetPrice: state.targetPrice, conviction: state.conviction, riskWillingness: state.riskWillingness, upsideDesire: state.upsideDesire, direction: state.direction, strategy: state.strategy, timelineMonths: state.timeline, minDte: state.minDte, maxDte: state.maxDte };
            const results = OptionsEngine.scanOptions(chain, params);
            state.results = results;
            state.dataSource = dataSource;
            dom.resultsSection.style.display = '';
            dom.resScanned.textContent = results.length.toLocaleString();
            dom.resDataSource.textContent = dataSource;
            if (results.length > 0) {
                dom.resBestScore.textContent = results[0].score.toFixed(1);
                const bestYield = Math.max(...results.map(r => r.annualizedYield));
                dom.resBestYield.textContent = `${bestYield.toFixed(1)}%`;
                const avgPop = results.reduce((s, r) => s + r.pop, 0) / results.length;
                dom.resAvgPop.textContent = `${avgPop.toFixed(1)}%`;
                renderTopPick(results[0]);
            }
            renderResults();
            setTimeout(() => {
                dom.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 200);
        } finally {
            dom.scanBtn.disabled = false;
            dom.scanBtn.querySelector('.scan-btn-text').style.display = '';
            dom.scanBtn.querySelector('.scan-btn-loading').style.display = 'none';
        }
    }
    function renderTopPick(pick) {
        dom.topPick.style.display = '';
        dom.topPickTitle.textContent = `${pick.type === 'put' ? 'Sell Put' : 'Sell Call'} — $${pick.strike} Strike — ${pick.expiry}`;
        const stats = [{ label: 'Premium (Mid)', value: `$${pick.mid.toFixed(2)}` }, { label: 'Annualized Yield', value: `${pick.annualizedYield.toFixed(1)}%` }, { label: 'Probability of Profit', value: `${pick.pop.toFixed(1)}%` }, { label: 'Margin of Safety', value: `${pick.safetyPct.toFixed(1)}%` }, { label: 'Break-Even', value: `$${pick.breakeven.toFixed(2)}` }, { label: 'DTE', value: `${pick.dte} days` }, { label: 'Delta', value: pick.delta.toFixed(4) }, { label: 'Theta', value: `$${pick.theta.toFixed(4)}` }, { label: 'IV', value: `${(pick.iv * 100).toFixed(1)}%` }, { label: 'Max Profit / Contract', value: `$${pick.maxProfit.toFixed(2)}` }, { label: 'Composite Score', value: pick.score.toFixed(1) }];
        dom.topPickStats.innerHTML = stats.map(s => `<div class="top-pick-stat"><span class="top-pick-stat-label">${s.label}</span><span class="top-pick-stat-value">${s.value}</span></div>`).join('');
        const safetyDesc = pick.safetyPct > 15 ? 'deep out-of-the-money' : pick.safetyPct > 5 ? 'comfortably out-of-the-money' : 'near-the-money';
        const popDesc = pick.pop > 80 ? 'very high' : pick.pop > 65 ? 'high' : 'moderate';
        const yieldDesc = pick.annualizedYield > 30 ? 'exceptional' : pick.annualizedYield > 15 ? 'strong' : 'reasonable';
        dom.topPickRationale.textContent = `This ${pick.type} at the $${pick.strike} strike is ${safetyDesc} with a ${popDesc} probability of profit (${pick.pop.toFixed(1)}%). It offers a ${yieldDesc} annualized yield of ${pick.annualizedYield.toFixed(1)}% with ${pick.dte} days until expiration. Your break-even price is $${pick.breakeven.toFixed(2)}, providing a ${pick.safetyPct.toFixed(1)}% buffer from the current price of $${state.currentPrice.toFixed(2)}.`;
    }
    function renderResults() {
        let data = [...state.results];
        if (state.filterType !== 'all') {
            data = data.filter(r => r.type === state.filterType);
        }
        data.sort((a, b) => {
            let aVal = a[state.sortKey];
            let bVal = b[state.sortKey];
            if (typeof aVal === 'string') {
                return state.sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            return state.sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        });
        const limited = data.slice(0, state.resultLimit);
        dom.resultsBody.innerHTML = limited.map((r, i) => {
            const rank = i + 1;
            return `<tr data-idx="${i}" onclick="window.__showDetail(${i})"><td>${rank}</td><td><span class="cell-type ${r.type}">${r.type}</span></td><td>$${r.strike.toFixed(2)}</td><td>${r.dte}</td><td>${r.expiry}</td><td>$${r.bid.toFixed(2)}</td><td>$${r.ask.toFixed(2)}</td><td>$${r.mid.toFixed(2)}</td><td class="cell-yield">${r.annualizedYield.toFixed(1)}%</td><td>${r.pop.toFixed(1)}%</td><td>${r.safetyPct.toFixed(1)}%</td><td>${r.delta.toFixed(3)}</td><td>${r.theta.toFixed(4)}</td><td>${(r.iv * 100).toFixed(1)}%</td><td class="cell-score">${r.score.toFixed(1)}</td></tr>`;
        }).join('');
        window.__filteredResults = limited;
    }
    window.__showDetail = function (idx) {
        const r = window.__filteredResults?.[idx];
        if (!r) return;
        dom.rowDetail.style.display = '';
        $('detailTitle').textContent = `${r.type === 'put' ? 'Put' : 'Call'} — $${r.strike} Strike — ${r.expiry}`;
        const items = [{ label: 'Contract', value: r.contractSymbol }, { label: 'Type', value: r.type.toUpperCase() }, { label: 'Strike', value: `$${r.strike.toFixed(2)}` }, { label: 'Expiration', value: r.expiry }, { label: 'DTE', value: `${r.dte} days` }, { label: 'Bid', value: `$${r.bid.toFixed(2)}` }, { label: 'Ask', value: `$${r.ask.toFixed(2)}` }, { label: 'Mid', value: `$${r.mid.toFixed(2)}` }, { label: 'Last Price', value: `$${r.lastPrice.toFixed(2)}` }, { label: 'Volume', value: r.volume.toLocaleString() }, { label: 'Open Interest', value: r.openInterest.toLocaleString() }, { label: 'IV', value: `${(r.iv * 100).toFixed(2)}%` }, { label: 'Delta', value: r.delta.toFixed(4) }, { label: 'Gamma', value: r.gamma.toFixed(4) }, { label: 'Theta', value: `$${r.theta.toFixed(4)} / day` }, { label: 'Vega', value: `$${r.vega.toFixed(4)}` }, { label: 'Annualized Yield', value: `${r.annualizedYield.toFixed(2)}%` }, { label: 'Probability of Profit', value: `${r.pop.toFixed(1)}%` }, { label: 'Margin of Safety', value: `${r.safetyPct.toFixed(2)}%` }, { label: 'Break-Even', value: `$${r.breakeven.toFixed(2)}` }, { label: 'Max Profit / Contract', value: `$${r.maxProfit.toFixed(2)}` }, { label: 'Max Loss / Contract', value: typeof r.maxLoss === 'string' ? r.maxLoss : `$${r.maxLoss.toFixed(2)}` }, { label: 'Total Premium', value: `$${(r.mid * 100 * state.maxContracts).toFixed(2)}` }, { label: 'In The Money', value: r.inTheMoney ? 'Yes' : 'No' }, { label: 'Composite Score', value: r.score.toFixed(2) }, { label: 'Premium Sub-Score', value: `${r.breakdown.premium}/100` }, { label: 'Safety Sub-Score', value: `${r.breakdown.safety}/100` }, { label: 'Probability Sub-Score', value: `${r.breakdown.probability}/100` }, { label: 'Forecast Sub-Score', value: `${r.breakdown.forecast}/100` }, { label: 'Liquidity Sub-Score', value: `${r.breakdown.liquidity}/100` }, { label: 'Time Decay Sub-Score', value: `${r.breakdown.timeDecay}/100` }];
        dom.detailGrid.innerHTML = items.map(item => `<div class="detail-item"><span class="detail-item-label">${item.label}</span><span class="detail-item-value">${item.value}</span></div>`).join('');
        setTimeout(() => dom.rowDetail.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    };
    function updateSortIndicators() {
        document.querySelectorAll('.results-table th.sortable').forEach(th => {
            th.classList.remove('sorted-asc', 'sorted-desc');
            if (th.dataset.sort === state.sortKey) {
                th.classList.add(state.sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
            }
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();