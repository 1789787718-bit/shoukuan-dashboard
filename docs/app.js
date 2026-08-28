
const { createApp } = Vue;

const app = createApp({
    data() {
        return {
            isAuthenticated: false,
            inputPassword: '',
            passwordError: '',
            isShaking: false,
            isStaticMode: false,
            allRecords: [],
            isDark: true,
            activeTab: 'overview',
            reloading: false,
            tabs: [
                { id: 'overview', name: '业务全景看板', icon: 'fas fa-chart-pie' },
                { id: 'managers', name: '负责人业绩', icon: 'fas fa-user-tie' },
                { id: 'risk', name: '欠款与风险监控', icon: 'fas fa-shield-alt' },
                { id: 'explorer', name: '车辆明细检索与档案', icon: 'fas fa-search' }
            ],
            overview: {
                generated_at: '',
                kpis: {},
                streams: [],
                managers: [],
                biz_categories: [],
                top_debtors: [],
                timeline: [],
                options: { managers: [], biz_categories: [], payment_statuses: [], expiry_statuses: [] }
            },
            kpis: {},
            filters: {
                keyword: '',
                manager: '全部',
                biz_category: '全部',
                payment_status: '全部',
                expiry_status: '全部'
            },
            sortBy: 'id',
            sortOrder: 'asc',
            tableData: {
                total: 0,
                page: 1,
                page_size: 50,
                total_pages: 1,
                summary: { total_receivable: 0, total_received: 0, total_unreceived: 0, collection_rate: 0 },
                records: []
            },
            selectedVehicle: null,
            searchTimer: null,
            charts: {}
        };
    },
    mounted() {
        const savedTheme = localStorage.getItem('theme');
        this.isDark = savedTheme ? savedTheme === 'dark' : true;
        this.applyTheme();

        const auth = sessionStorage.getItem('dashboard_auth');
        if (auth === 'true') {
            this.isAuthenticated = true;
            this.initDashboard();
        }

        window.addEventListener('resize', () => {
            Object.values(this.charts).forEach(c => c && c.resize());
        });
    },
    methods: {
        handleLogin() {
            if (this.inputPassword === '121233') {
                this.passwordError = '';
                this.isAuthenticated = true;
                sessionStorage.setItem('dashboard_auth', 'true');
                this.initDashboard();
            } else {
                this.passwordError = '访问密码错误，请重新输入';
                this.isShaking = true;
                setTimeout(() => { this.isShaking = false; }, 500);
            }
        },
        handleLogout() {
            this.isAuthenticated = false;
            this.inputPassword = '';
            sessionStorage.removeItem('dashboard_auth');
        },
        initDashboard() {
            this.$nextTick(() => {
                this.fetchOverview();
                this.fetchRecords(1);
            });
        },
        applyTheme() {
            if (this.isDark) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
            localStorage.setItem('theme', this.isDark ? 'dark' : 'light');
        },
        toggleTheme() {
            this.isDark = !this.isDark;
            this.applyTheme();
            this.$nextTick(() => {
                this.renderAllCharts();
            });
        },
        switchTab(tabId) {
            this.activeTab = tabId;
            this.$nextTick(() => {
                setTimeout(() => {
                    Object.values(this.charts).forEach(c => c && c.resize());
                    if (tabId === 'overview') {
                        this.renderStreamsChart();
                        this.renderPieChart();
                        this.renderBizCategoryChart();
                    } else if (tabId === 'managers') {
                        this.renderManagerChart();
                    } else if (tabId === 'risk') {
                        this.renderDebtorsChart();
                        this.renderTimelineChart();
                    }
                }, 50);
            });
        },
        async fetchOverview() {
            try {
                // 优先请求本地后端 API
                const res = await fetch('/api/overview');
                if (!res.ok) throw new Error('API unavailable, falling back to static');
                const data = await res.json();
                this.overview = data;
                this.kpis = data.kpis || {};
                this.isStaticMode = false;
                this.$nextTick(() => { this.renderAllCharts(); });
            } catch (err) {
                // 静态模式回退 (用于 GitHub Pages 等静态部署环境)
                console.log('检测到静态托管环境，直接加载全量 JSON 数据集...');
                this.isStaticMode = true;
                try {
                    const dataRes = await fetch('./data/dashboard_data.json');
                    const staticData = await dataRes.json();
                    this.overview = staticData;
                    this.kpis = staticData.kpis || {};
                    this.allRecords = staticData.records || [];
                    this.$nextTick(() => { this.renderAllCharts(); });
                    this.fetchStaticRecords();
                } catch (staticErr) {
                    console.error('静态数据加载失败:', staticErr);
                }
            }
        },
        async fetchRecords(page = 1) {
            this.tableData.page = page;
            if (this.isStaticMode) {
                this.fetchStaticRecords();
                return;
            }

            const params = new URLSearchParams({
                page: this.tableData.page,
                page_size: this.tableData.page_size,
                keyword: this.filters.keyword || '',
                manager: this.filters.manager || '全部',
                biz_category: this.filters.biz_category || '全部',
                payment_status: this.filters.payment_status || '全部',
                expiry_status: this.filters.expiry_status || '全部',
                sort_by: this.sortBy,
                sort_order: this.sortOrder
            });

            try {
                const res = await fetch(`/api/records?${params.toString()}`);
                if (!res.ok) throw new Error('Fetch failed');
                const data = await res.json();
                this.tableData.total = data.total;
                this.tableData.total_pages = data.total_pages;
                this.tableData.summary = data.summary;
                this.tableData.records = data.records;
            } catch (err) {
                this.isStaticMode = true;
                this.fetchStaticRecords();
            }
        },
        fetchStaticRecords() {
            let list = this.allRecords || [];
            const kw = (this.filters.keyword || '').trim().toLowerCase();
            if (kw) {
                list = list.filter(r => 
                    (r.plate_no && r.plate_no.toLowerCase().includes(kw)) ||
                    (r.org_name && r.org_name.toLowerCase().includes(kw)) ||
                    (r.remark && r.remark.toLowerCase().includes(kw)) ||
                    (r.biz_type && r.biz_type.toLowerCase().includes(kw))
                );
            }
            if (this.filters.manager && this.filters.manager !== '全部') {
                list = list.filter(r => r.manager === this.filters.manager);
            }
            if (this.filters.biz_category && this.filters.biz_category !== '全部') {
                list = list.filter(r => r.biz_category === this.filters.biz_category);
            }
            if (this.filters.payment_status && this.filters.payment_status !== '全部') {
                list = list.filter(r => r.payment_status === this.filters.payment_status);
            }
            if (this.filters.expiry_status && this.filters.expiry_status !== '全部') {
                list = list.filter(r => r.expiry_status === this.filters.expiry_status);
            }

            const recSum = list.reduce((a, b) => a + (b.total_receivable || 0), 0);
            const paidSum = list.reduce((a, b) => a + (b.total_received || 0), 0);
            const unrecSum = list.reduce((a, b) => a + (b.total_unreceived || 0), 0);

            this.tableData.total = list.length;
            this.tableData.total_pages = Math.ceil(list.length / this.tableData.page_size) || 1;
            this.tableData.summary = {
                total_receivable: Math.round(recSum * 100) / 100,
                total_received: Math.round(paidSum * 100) / 100,
                total_unreceived: Math.round(unrecSum * 100) / 100,
                collection_rate: recSum > 0 ? Math.round((paidSum / recSum) * 10000) / 100 : 0
            };

            // 排序
            const key = this.sortBy;
            const rev = this.sortOrder === 'desc';
            list.sort((a, b) => {
                let va = a[key];
                let vb = b[key];
                if (typeof va === 'string') return rev ? vb.localeCompare(va) : va.localeCompare(vb);
                return rev ? (vb - va) : (va - vb);
            });

            // 分页
            const start = (this.tableData.page - 1) * this.tableData.page_size;
            this.tableData.records = list.slice(start, start + this.tableData.page_size);
        },
        debounceSearch() {
            clearTimeout(this.searchTimer);
            this.searchTimer = setTimeout(() => {
                this.fetchRecords(1);
            }, 300);
        },
        resetFilters() {
            this.filters = {
                keyword: '',
                manager: '全部',
                biz_category: '全部',
                payment_status: '全部',
                expiry_status: '全部'
            };
            this.fetchRecords(1);
        },
        sortByColumn(col) {
            if (this.sortBy === col) {
                this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                this.sortBy = col;
                this.sortOrder = 'desc';
            }
            this.fetchRecords(1);
        },
        filterByManager(mgr) {
            this.filters.manager = mgr;
            this.filters.keyword = '';
            this.activeTab = 'explorer';
            this.fetchRecords(1);
        },
        filterByOrg(org) {
            this.filters.keyword = org;
            this.filters.manager = '全部';
            this.activeTab = 'explorer';
            this.fetchRecords(1);
        },
        openVehicleDrawer(r) {
            this.selectedVehicle = r;
        },
        async reloadExcel() {
            this.reloading = true;
            try {
                const res = await fetch('/api/reload');
                const data = await res.json();
                alert(data.message || '重载成功！');
                await this.fetchOverview();
                await this.fetchRecords(1);
            } catch (err) {
                alert('重载失败：' + err.message);
            } finally {
                this.reloading = false;
            }
        },
        exportCurrentFiltered() {
            if (!this.isStaticMode) {
                const params = new URLSearchParams({
                    keyword: this.filters.keyword || '',
                    manager: this.filters.manager || '全部',
                    biz_category: this.filters.biz_category || '全部',
                    payment_status: this.filters.payment_status || '全部',
                    expiry_status: this.filters.expiry_status || '全部'
                });
                window.location.href = `/api/export?${params.toString()}`;
            } else {
                // 静态模式导出 CSV
                let list = this.allRecords || [];
                const kw = (this.filters.keyword || '').trim().toLowerCase();
                if (kw) {
                    list = list.filter(r => 
                        (r.plate_no && r.plate_no.toLowerCase().includes(kw)) ||
                        (r.org_name && r.org_name.toLowerCase().includes(kw)) ||
                        (r.remark && r.remark.toLowerCase().includes(kw))
                    );
                }
                if (this.filters.manager && this.filters.manager !== '全部') list = list.filter(r => r.manager === this.filters.manager);
                if (this.filters.payment_status && this.filters.payment_status !== '全部') list = list.filter(r => r.payment_status === this.filters.payment_status);

                let csv = "\ufeff序号,车牌号码,车辆组织,业务分类,业务负责人,总应收,总已收,总未收,收款状态,服务到期日,备注\n";
                list.forEach(r => {
                    csv += `"${r.id}","${r.plate_no}","${r.org_name}","${r.biz_category}","${r.manager}","${r.total_receivable}","${r.total_received}","${r.total_unreceived}","${r.payment_status}","${r.primary_due_date}","${(r.remark||'').replace(/"/g, '""')}"\n`;
                });
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.setAttribute("download", "天宏平台车辆收款明细导出.csv");
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        },

        renderAllCharts() {
            this.renderStreamsChart();
            this.renderPieChart();
            this.renderBizCategoryChart();
            this.renderManagerChart();
            this.renderDebtorsChart();
            this.renderTimelineChart();
        },
        getChartTheme() {
            const textColor = this.isDark ? '#cbd5e1' : '#475569';
            const gridColor = this.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
            const tooltipBg = this.isDark ? 'rgba(30, 41, 59, 0.95)' : 'rgba(255, 255, 255, 0.95)';
            const tooltipBorder = this.isDark ? '#475569' : '#e2e8f0';
            return { textColor, gridColor, tooltipBg, tooltipBorder };
        },
        renderStreamsChart() {
            const el = document.getElementById('streamsChart');
            if (!el || !this.overview.streams || this.overview.streams.length === 0) return;
            if (!this.charts.streams) {
                this.charts.streams = echarts.init(el);
            }
            const theme = this.getChartTheme();
            const categories = this.overview.streams.map(s => s.name);
            const recData = this.overview.streams.map(s => s.receivable);
            const paidData = this.overview.streams.map(s => s.received);
            const unrecData = this.overview.streams.map(s => s.unreceived);

            const option = {
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: theme.tooltipBg,
                    borderColor: theme.tooltipBorder,
                    textStyle: { color: theme.textColor },
                    axisPointer: { type: 'shadow' }
                },
                legend: {
                    data: ['应收款', '实收金额', '未收/欠款'],
                    textStyle: { color: theme.textColor },
                    top: 0
                },
                grid: { left: '3%', right: '4%', bottom: '3%', top: '15%', containLabel: true },
                xAxis: {
                    type: 'category',
                    data: categories,
                    axisLabel: { color: theme.textColor },
                    axisLine: { lineStyle: { color: theme.gridColor } }
                },
                yAxis: {
                    type: 'value',
                    axisLabel: { color: theme.textColor, formatter: '¥{value}' },
                    splitLine: { lineStyle: { color: theme.gridColor } }
                },
                series: [
                    {
                        name: '应收款',
                        type: 'bar',
                        barGap: '15%',
                        data: recData,
                        itemStyle: { color: '#6366f1', borderRadius: [4, 4, 0, 0] }
                    },
                    {
                        name: '实收金额',
                        type: 'bar',
                        data: paidData,
                        itemStyle: { color: '#10b981', borderRadius: [4, 4, 0, 0] }
                    },
                    {
                        name: '未收/欠款',
                        type: 'bar',
                        data: unrecData,
                        itemStyle: { color: '#f43f5e', borderRadius: [4, 4, 0, 0] }
                    }
                ]
            };
            this.charts.streams.setOption(option);
        },
        renderPieChart() {
            const el = document.getElementById('pieChart');
            if (!el || !this.overview.streams || this.overview.streams.length === 0) return;
            if (!this.charts.pie) {
                this.charts.pie = echarts.init(el);
            }
            const theme = this.getChartTheme();
            const pieData = this.overview.streams
                .filter(s => s.received > 0)
                .map(s => ({ name: s.name, value: s.received }));

            const option = {
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'item',
                    backgroundColor: theme.tooltipBg,
                    borderColor: theme.tooltipBorder,
                    textStyle: { color: theme.textColor },
                    formatter: '{b}: ¥{c} ({d}%)'
                },
                legend: {
                    bottom: '0%',
                    left: 'center',
                    textStyle: { color: theme.textColor, fontSize: 11 }
                },
                series: [
                    {
                        name: '实收构成',
                        type: 'pie',
                        radius: ['45%', '70%'],
                        avoidLabelOverlap: false,
                        itemStyle: {
                            borderRadius: 6,
                            borderColor: this.isDark ? '#1e293b' : '#ffffff',
                            borderWidth: 2
                        },
                        label: { show: false, position: 'center' },
                        emphasis: {
                            label: { show: true, fontSize: 14, fontWeight: 'bold', color: theme.textColor }
                        },
                        data: pieData
                    }
                ]
            };
            this.charts.pie.setOption(option);
        },
        renderBizCategoryChart() {
            const el = document.getElementById('bizCategoryChart');
            if (!el || !this.overview.biz_categories || this.overview.biz_categories.length === 0) return;
            if (!this.charts.bizCategory) {
                this.charts.bizCategory = echarts.init(el);
            }
            const theme = this.getChartTheme();
            const categories = this.overview.biz_categories.map(b => b.category);
            const counts = this.overview.biz_categories.map(b => b.count);
            const receiveds = this.overview.biz_categories.map(b => b.received);

            const option = {
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: theme.tooltipBg,
                    borderColor: theme.tooltipBorder,
                    textStyle: { color: theme.textColor }
                },
                legend: {
                    data: ['车辆数量 (辆)', '已收金额 (元)'],
                    textStyle: { color: theme.textColor },
                    top: 0
                },
                grid: { left: '3%', right: '4%', bottom: '3%', top: '15%', containLabel: true },
                xAxis: {
                    type: 'category',
                    data: categories,
                    axisLabel: { color: theme.textColor, rotate: 15 },
                    axisLine: { lineStyle: { color: theme.gridColor } }
                },
                yAxis: [
                    {
                        type: 'value',
                        name: '车辆数',
                        nameTextStyle: { color: theme.textColor },
                        axisLabel: { color: theme.textColor },
                        splitLine: { lineStyle: { color: theme.gridColor } }
                    },
                    {
                        type: 'value',
                        name: '已收款 (元)',
                        nameTextStyle: { color: theme.textColor },
                        axisLabel: { color: theme.textColor },
                        splitLine: { show: false }
                    }
                ],
                series: [
                    {
                        name: '车辆数量 (辆)',
                        type: 'bar',
                        data: counts,
                        itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] }
                    },
                    {
                        name: '已收金额 (元)',
                        type: 'line',
                        yAxisIndex: 1,
                        smooth: true,
                        data: receiveds,
                        itemStyle: { color: '#10b981' },
                        lineStyle: { width: 3 }
                    }
                ]
            };
            this.charts.bizCategory.setOption(option);
        },
        renderManagerChart() {
            const el = document.getElementById('managerChart');
            if (!el || !this.overview.managers || this.overview.managers.length === 0) return;
            if (!this.charts.manager) {
                this.charts.manager = echarts.init(el);
            }
            const theme = this.getChartTheme();
            const topManagers = this.overview.managers.slice(0, 10);
            const names = topManagers.map(m => m.manager).reverse();
            const paid = topManagers.map(m => m.received).reverse();
            const unrec = topManagers.map(m => m.unreceived).reverse();

            const option = {
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis',
                    axisPointer: { type: 'shadow' },
                    backgroundColor: theme.tooltipBg,
                    borderColor: theme.tooltipBorder,
                    textStyle: { color: theme.textColor }
                },
                legend: {
                    data: ['已收款 (元)', '欠款 (元)'],
                    textStyle: { color: theme.textColor },
                    top: 0
                },
                grid: { left: '3%', right: '6%', bottom: '3%', top: '12%', containLabel: true },
                xAxis: {
                    type: 'value',
                    axisLabel: { color: theme.textColor },
                    splitLine: { lineStyle: { color: theme.gridColor } }
                },
                yAxis: {
                    type: 'category',
                    data: names,
                    axisLabel: { color: theme.textColor }
                },
                series: [
                    {
                        name: '已收款 (元)',
                        type: 'bar',
                        stack: 'total',
                        data: paid,
                        itemStyle: { color: '#10b981' }
                    },
                    {
                        name: '欠款 (元)',
                        type: 'bar',
                        stack: 'total',
                        data: unrec,
                        itemStyle: { color: '#f43f5e', borderRadius: [0, 4, 4, 0] }
                    }
                ]
            };
            this.charts.manager.setOption(option);
        },
        renderDebtorsChart() {
            const el = document.getElementById('debtorsChart');
            if (!el || !this.overview.top_debtors || this.overview.top_debtors.length === 0) return;
            if (!this.charts.debtors) {
                this.charts.debtors = echarts.init(el);
                this.charts.debtors.on('click', (params) => {
                    this.filterByOrg(params.name);
                });
            }
            const theme = this.getChartTheme();
            const debtors = this.overview.top_debtors.slice(0, 10).reverse();
            const orgNames = debtors.map(d => d.org_name.length > 12 ? d.org_name.substring(0, 12) + '...' : d.org_name);
            const fullNames = debtors.map(d => d.org_name);
            const unreceived = debtors.map(d => d.unreceived);

            const option = {
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: theme.tooltipBg,
                    borderColor: theme.tooltipBorder,
                    textStyle: { color: theme.textColor },
                    formatter: function(params) {
                        const idx = params[0].dataIndex;
                        return `${fullNames[idx]}<br/>欠款总额: ¥${params[0].value.toLocaleString()}`;
                    }
                },
                grid: { left: '3%', right: '6%', bottom: '3%', top: '5%', containLabel: true },
                xAxis: {
                    type: 'value',
                    axisLabel: { color: theme.textColor },
                    splitLine: { lineStyle: { color: theme.gridColor } }
                },
                yAxis: {
                    type: 'category',
                    data: orgNames,
                    axisLabel: { color: theme.textColor, fontSize: 11 }
                },
                series: [
                    {
                        name: '欠款金额',
                        type: 'bar',
                        data: unreceived,
                        itemStyle: {
                            color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
                                { offset: 0, color: '#f43f5e' },
                                { offset: 1, color: '#fb7185' }
                            ]),
                            borderRadius: [0, 4, 4, 0]
                        },
                        label: {
                            show: true,
                            position: 'right',
                            color: theme.textColor,
                            formatter: '¥{c}'
                        }
                    }
                ]
            };
            this.charts.debtors.setOption(option);
        },
        renderTimelineChart() {
            const el = document.getElementById('timelineChart');
            if (!el || !this.overview.timeline || this.overview.timeline.length === 0) return;
            if (!this.charts.timeline) {
                this.charts.timeline = echarts.init(el);
            }
            const theme = this.getChartTheme();
            const years = this.overview.timeline.map(t => t.year);
            const counts = this.overview.timeline.map(t => t.count);

            const option = {
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: theme.tooltipBg,
                    borderColor: theme.tooltipBorder,
                    textStyle: { color: theme.textColor }
                },
                grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
                xAxis: {
                    type: 'category',
                    data: years,
                    axisLabel: { color: theme.textColor }
                },
                yAxis: {
                    type: 'value',
                    name: '车辆数',
                    nameTextStyle: { color: theme.textColor },
                    axisLabel: { color: theme.textColor },
                    splitLine: { lineStyle: { color: theme.gridColor } }
                },
                series: [
                    {
                        name: '车辆数',
                        type: 'bar',
                        data: counts,
                        itemStyle: { color: '#f59e0b', borderRadius: [4, 4, 0, 0] }
                    }
                ]
            };
            this.charts.timeline.setOption(option);
        },
        formatMoney(val) {
            if (val === undefined || val === null) return '0.00';
            return Number(val).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },
        formatNumber(val) {
            if (val === undefined || val === null) return '0';
            return Number(val).toLocaleString('zh-CN');
        },
        getStatusBadgeClass(status) {
            if (status === '已结清') return 'px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
            if (status === '部分收款') return 'px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
            if (status === '未交款') return 'px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300';
            return 'px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
        },
        getExpiryBadgeClass(status) {
            if (status === '已过期') return 'px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300';
            if (status === '30天内到期') return 'px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
            if (status === '正常服务中') return 'px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
            return 'px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
        },
        getSortIcon(col) {
            if (this.sortBy !== col) return 'fas fa-sort text-slate-300 dark:text-slate-600 ml-1';
            return this.sortOrder === 'asc' ? 'fas fa-sort-up text-blue-500 ml-1' : 'fas fa-sort-down text-blue-500 ml-1';
        }
    }
});

app.mount('#app');
