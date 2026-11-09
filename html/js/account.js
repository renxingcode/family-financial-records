const {createApp, ref, computed, onMounted, watch} = Vue;

// 底层依赖（IIFE 全局挂载）
const Utils = window.FinancialUtils;
const AccountData = window.AccountData;

/**
 * VERSION_NUMBER: 数据格式版本号
 * 用于标识导出 JSON 的数据结构版本，仅在数据格式发生不兼容变更时递增。
 * 当前版本：1.0 - 稳定数据结构（card_xxx_deposit / card_xxx_debt 扁平结构）
 */
const VERSION_NUMBER = 1.0;

/**
 * DEFAULT_UI_PREFS: 界面偏好默认值
 * 新增偏好字段时在这里补默认，保证旧数据缺字段也能正常读取。
 */
var DEFAULT_UI_PREFS = {
    showPrevData: false,
    showRemark: true,
    targetReminderExpanded: false
};

/**
 * 软删除银行卡（标记 isDeleted，历史数据保留）
 * @param {Array} configs 银行卡配置数组
 * @param {string} key 银行卡 key
 * @returns {Promise<boolean>} 是否删除成功
 */
async function softDeleteBankCard(configs, key) {
    const card = configs.find(c => c.key === key);
    if (!card) return false;
    card.isDeleted = true;
    await AccountData.saveBankCardConfigs(configs);
    return true;
}

/**
 * 恢复银行卡：软删除标记还原，历史数据自动恢复显示
 * @param {Array} configs 银行卡配置数组
 * @param {string} key 银行卡 key
 * @returns {Promise<Object|null>} 恢复后的银行卡配置；不存在时返回 null
 */
async function restoreBankCard(configs, key) {
    const card = configs.find(c => c.key === key);
    if (!card) return null;
    card.isDeleted = false;
    card.showInList = true; // 恢复后默认重新显示在列表中
    await AccountData.saveBankCardConfigs(configs);
    return card;
}

/**
 * 彻底删除银行卡：从配置中移除，并清除所有历史记录中该卡字段。不可恢复。
 * @param {Array} configs 银行卡配置数组
 * @param {Array} records 账户记录数组
 * @param {string} key 银行卡 key
 * @returns {Promise<Object|null>} {label, removedCount}；不存在时返回 null
 */
async function permanentDeleteBankCard(configs, records, key) {
    const card = configs.find(c => c.key === key);
    if (!card) return null;
    const label = card.label;

    const idx = configs.findIndex(c => c.key === key);
    if (idx !== -1) configs.splice(idx, 1);
    await AccountData.saveBankCardConfigs(configs);

    const depositField = key + '_deposit';
    const debtField = key + '_debt';
    let removedCount = 0;
    (records || []).forEach(rec => {
        let changed = false;
        if (Object.prototype.hasOwnProperty.call(rec, depositField)) {
            delete rec[depositField];
            changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(rec, debtField)) {
            delete rec[debtField];
            changed = true;
        }
        if (changed) removedCount++;
    });
    if (removedCount > 0) {
        await AccountData.saveRecords(records);
    }
    return {label: label, removedCount: removedCount};
}

const app = createApp({
    setup() {
        // 数据
        const records = ref([]);
        const configs = ref([]);

        // 响应式：分页
        const currentPage = ref(1);         // 当前页码
        const jumpPage = ref(1);            // 分页跳转输入框页码
        const pageSize = 10;                // 每页显示记录数

        // Toast
        const toastMsg = ref('');
        let toastTimer = null;

        // 记录弹窗
        const modalVisible = ref(false);
        const modalMode = ref('add');   // 'add' | 'edit'
        const editable = ref(false);    // 编辑态（true）还是查看态（false）
        const isCopy = ref(false);      // 是否为复制记录（复制时弹窗标题与提示条用）
        let copySourceIndex = -1;       // 复制来源记录下标（返回时回到原记录查看态）
        const editIndex = ref(-1);
        const form = ref({});
        // 详情逐卡对比：当前查看记录的上一条（日期更早的相邻）记录
        const prevRecord = ref(null);
        const showPrevData = ref(DEFAULT_UI_PREFS.showPrevData);  // 详情逐卡对比开关
        // 差额气泡：当前点击的“上次”对比项 key（再点关闭）
        const bubbleKey = ref('');
        const showRemark = ref(DEFAULT_UI_PREFS.showRemark);  // 备注输入框是否展开（编辑态，按上次偏好）

        // 银行卡管理
        const bankManagerVisible = ref(false);
        const bankFormVisible = ref(false);
        const bankFormMode = ref('add');  // 'add' | 'edit'
        const bankForm = ref({key: '', label: '', category: ['deposit', 'debt'], showInList: true});
        const editingCardKey = ref('');
        // 弹窗打开时的表单快照（JSON），关闭时据此判断是否有未保存修改
        let formSnapshot = '';
        let targetSnapshot = '';

        // 回收站
        const recycleBinVisible = ref(false);
        const recycleConfirmVisible = ref(false); // 彻底删除红色警示确认弹窗
        const recycleTargetCard = ref(null);      // 待彻底删除的银行卡

        // 目标
        const targetModalVisible = ref(false);
        const targetEditable = ref(false);
        const targetReminderExpanded = ref(DEFAULT_UI_PREFS.targetReminderExpanded);
        const targetForm = ref({
            annualIncome: '',
            incomeRemark: '',
            annualExpense: '',   // 每年支出
            expenseRemark: '',   // 每年支出说明
            targetAmount: 0,     // 目标金额自动计算，不再手工输入
            targetDate: '',
            targetRemark: '',
            currentBalance: 0,
            remaining: 0,
            targetDateDisplay: '',
            targetDuration: ''
        });
        const targetCalculated = ref(false);

        // 计算
        /**
         * 计算距离目标日期的剩余月数（超过 15 天算一个月）
         */
        const computedMonths = computed(() => {
            return Utils.calcMonths(targetForm.value.targetDate);
        });

        /**
         * 目标金额自动计算（每年支出 ÷ 12 × 剩余月数）
         */
        const computedTargetAmount = computed(() => {
            return Utils.calcTargetAmount(targetForm.value.annualExpense, targetForm.value.targetDate);
        });

        /**
         * 将月数格式化为「X年X个月之后」
         */
        const computedDurationFromMonths = computed(() => {
            return Utils.formatDuration(computedMonths.value);
        });

        // displayFields: 列表中实际显示的银行卡列（禁用、隐藏或已删除的不显示）
        const displayFields = computed(() => {
            return configs.value.filter(f => !f.disabled && !f.isDeleted && f.showInList !== false);
        });
        const allConfigs = computed(() => configs.value);
        // 银行卡管理面板列表（未删除的卡，含禁用）；顺序即 configs 数组顺序，供上移/下移手动排序
        const activeCards = computed(() => configs.value.filter(c => !c.isDeleted));
        const editableFields = computed(() => {
            if (modalMode.value === 'add') {
                return configs.value.filter(f => !f.disabled);
            } else {
                return configs.value;
            }
        });

        const sortedRecords = computed(() => {
            return [...records.value].sort((a, b) => b.date.localeCompare(a.date));
        });

        /**
         * 分页相关计算
         * totalPages: 总页数
         * paginatedRecords: 当前页显示的记录
         */
        const totalPages = computed(() => Math.ceil(sortedRecords.value.length / pageSize) || 1);
        const paginatedRecords = computed(() => {
            const start = (currentPage.value - 1) * pageSize;
            return sortedRecords.value.slice(start, start + pageSize);
        });

        // 核心函数
        // 列表单元格取值：
        // - 字段非零 → 显示数值（历史数据，与当前 category 无关）
        // - 字段为 0 且 category 含该类型 → 显示 0（配置了类型，真实为 0）
        // - 字段为 0 且 category 不含该类型 → 返回 null 显示 "-"（取消类型后新增的数据）
        function getFieldValue(item, f, type) {
            const fieldName = f.key + '_' + type;
            const val = Number(item[fieldName]) || 0;
            if (val !== 0) return val;
            if (!f.category.includes(type)) return null;
            return 0;
        }

        /**
         * 详情「对比上次」：返回某对比项的上次值与差额
         * @param {string} key 'total_balance'/'total_deposit'/'total_debt' 或 'deposit_{卡key}'/'debt_{卡key}'
         * @returns {{prev:(number|null), diff:(number|null)}|null} 开关关/非查看态/无上次记录时返回 null；
         *          上次无该字段时 prev/diff 均为 null
         */
        function getPrevData(key) {
            if (!showPrevData.value) return null;
            if (modalMode.value !== 'edit' || editable.value) return null;
            if (!prevRecord.value) return null;
            const curForm = form.value;
            const prevForm = prevRecord.value;
            let cur, prev;
            if (key === 'total_balance') {
                cur = getBalance(curForm);
                prev = getBalance(prevForm);
            } else if (key === 'total_deposit') {
                cur = getTotalDeposit(curForm);
                prev = getTotalDeposit(prevForm);
            } else if (key === 'total_debt') {
                cur = getTotalDebt(curForm);
                prev = getTotalDebt(prevForm);
            } else {
                const m = key.match(/^(deposit|debt)_(.+)$/);
                if (!m) return null;
                const field = m[2] + '_' + m[1];
                cur = Number(curForm[field]) || 0;
                if (!(field in prevForm)) return { prev: null, diff: null };
                prev = Number(prevForm[field]) || 0;
            }
            return { prev: prev, diff: cur - prev };
        }

        /**
         * 切换差额气泡：点哪个“上次”项显示其差额，再点关闭
         * 该项没有有效上次数据（第一条记录或新增的卡）时不弹气泡，避免出现只写“差额”的空气泡
         */
        function toggleBubble(key) {
            if (bubbleKey.value === key) {
                bubbleKey.value = '';
                return;
            }
            const data = getPrevData(key);
            if (!data || data.prev === null || data.prev === undefined) return;
            bubbleKey.value = key;
        }

        /**
         * 切换详情“对比上次”开关
         * 第一条记录（没有上一条）无法对比，仅提示，不修改全局开关 showPrevData，
         * 避免看完第一条后把其他详情页持久化的对比状态冲掉
         */
        function toggleShowPrev() {
            if (!prevRecord.value) {
                showToast('当前是第一条记录，无法对比上次');
                return;
            }
            showPrevData.value = !showPrevData.value;
        }

        /**
         * 上次记录的日期（日期旁展示，不可点击）
         */
        const prevDateText = computed(() => {
            if (!prevRecord.value) return '';
            return Utils.formatDateToDot(prevRecord.value.date);
        });

        /**
         * 差额带正负号格式化（正数补 +，0 显示 0）
         */
        function formatSigned(num) {
            if (num === null || num === undefined || isNaN(num)) return '';
            return (num > 0 ? '+' : '') + Utils.formatNumber(num);
        }

        // 总存款：所有 *_deposit 字段之和（含已删除银行卡的历史数据）
        function getTotalDeposit(item) {
            let sum = 0;
            Object.keys(item).forEach(key => {
                if (key.endsWith('_deposit')) {
                    sum += Number(item[key]) || 0;
                }
            });
            return sum;
        }

        // 总负债：所有 *_debt 字段之和（含已删除银行卡的历史数据）
        function getTotalDebt(item) {
            let sum = 0;
            Object.keys(item).forEach(key => {
                if (key.endsWith('_debt')) {
                    sum += Number(item[key]) || 0;
                }
            });
            return sum;
        }

        function getBalance(item) {
            return getTotalDeposit(item) - getTotalDebt(item);
        }

        // 活动银行卡 key（未删除的卡，含禁用）
        function getActiveCardKeys() {
            return configs.value.filter(c => !c.isDeleted).map(c => c.key);
        }

        // 检查记录中是否存在已删除银行卡的数据（决定是否显示汇总行）
        function hasDeletedFields(item) {
            const activeKeys = getActiveCardKeys();
            return Object.keys(item).some(key => {
                if (key.endsWith('_deposit') || key.endsWith('_debt')) {
                    const prefix = key.endsWith('_deposit') ? key.slice(0, -8) : key.slice(0, -5);
                    return activeKeys.indexOf(prefix) === -1 && Number(item[key]) !== 0;
                }
                return false;
            });
        }

        // 已删除银行卡的存款合计
        function getDeletedDepositTotal(item) {
            const activeKeys = getActiveCardKeys();
            let sum = 0;
            Object.keys(item).forEach(key => {
                if (key.endsWith('_deposit')) {
                    const prefix = key.slice(0, -8);
                    if (activeKeys.indexOf(prefix) === -1) {
                        sum += Number(item[key]) || 0;
                    }
                }
            });
            return sum;
        }

        // 已删除银行卡的负债合计
        function getDeletedDebtTotal(item) {
            const activeKeys = getActiveCardKeys();
            let sum = 0;
            Object.keys(item).forEach(key => {
                if (key.endsWith('_debt')) {
                    const prefix = key.slice(0, -5);
                    if (activeKeys.indexOf(prefix) === -1) {
                        sum += Number(item[key]) || 0;
                    }
                }
            });
            return sum;
        }

        /**
         * 计算某条记录与上一条记录的余额差额（对比差额）
         * 上一条指的是"日期更早"的那条记录（因为 sortedRecords 按日期降序排列）
         * @param {Object} item - 当前记录
         * @returns {number|null} 差额（当前余额 - 上一条余额），如果没有上一条则返回 null
         */
        function getDiff(item) {
            const realIdx = sortedRecords.value.indexOf(item);
            if (realIdx === -1 || realIdx + 1 >= sortedRecords.value.length) return null;
            const prev = sortedRecords.value[realIdx + 1];
            return getBalance(item) - getBalance(prev);
        }

        /**
         * 记录弹窗中是否显示该银行卡字段
         * 添加模式：只显示未禁用的银行卡
         * 编辑模式：显示所有未禁用卡，以及该记录中有非零金额的禁用卡（历史数据可继续修改）
         * 查看模式：只显示该记录中有非零金额的卡，避免大量 0 值占位
         * @param {Object} f - 银行卡配置项
         * @returns {boolean}
         */
        function shouldShowFieldInModal(f) {
            // 已删除的银行卡不单独显示，数据归入「已删除汇总」
            if (f.isDeleted) {
                return false;
            }
            // 添加模式：只显示未禁用的银行卡
            if (modalMode.value === 'add') {
                return !f.disabled;
            }
            // 该记录中该卡是否有非零金额（按 category 检查，避免 undefined 字段误判）
            const hasNonZero = f.category.some(type => {
                const val = Number(form.value[f.key + '_' + type]) || 0;
                return val !== 0;
            });
            // 编辑模式：未禁用 或 该记录有非零金额（含已禁用卡的历史数据）
            if (editable.value) {
                return !f.disabled || hasNonZero;
            }
            // 查看模式：只显示有非零金额的卡
            return hasNonZero;
        }

        // 弹窗中某卡某类型是否显示：
        // - 当前配置含该类型 → 显示
        // - add 模式（含复制）：严格按当前配置，不带出已取消类型的历史数据
        // - edit/view 模式：有非零历史数据也显示（历史数据可继续查看/修改）
        function shouldShowTypeField(f, type) {
            if (f.category.includes(type)) return true;
            if (modalMode.value === 'add') return false;
            return (Number(form.value[f.key + '_' + type]) || 0) !== 0;
        }

        function prevPage() {
            if (currentPage.value > 1) currentPage.value--;
            jumpPage.value = currentPage.value;
        }

        function nextPage() {
            if (currentPage.value < totalPages.value) currentPage.value++;
            jumpPage.value = currentPage.value;
        }

        // 跳转到指定页
        function goToPage() {
            const p = Number(jumpPage.value);
            if (isNaN(p) || p < 1 || p > totalPages.value) {
                showToast('请输入 1~' + totalPages.value + ' 之间的页码');
                jumpPage.value = currentPage.value;
                return;
            }
            currentPage.value = p;
            jumpPage.value = p;
        }

        // 全屏
        function toggleFullscreen() {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen?.() || document.documentElement.webkitRequestFullscreen?.();
            } else {
                document.exitFullscreen?.() || document.webkitExitFullscreen?.();
            }
        }

        async function exportCSV() {
            if (records.value.length === 0) {
                showToast('暂无数据');
                return;
            }

            // 按日期降序排列
            const sorted = [...records.value].sort((a, b) => b.date.localeCompare(a.date));

            // 1. 构建目标计划部分（若已设置目标）
            let csv = '';

            // 读取目标数据
            const targetData = await AccountData.loadTarget();

            if (targetData) {
                // 当前总余额：取最新一条记录的余额
                const latest = sorted[0];
                const currentBalance = latest ? getBalance(latest) : 0;
                // 目标金额实时计算（每年支出 ÷ 12 × 剩余月数）
                const targetAmount = Utils.calcTargetAmount(targetData.annualExpense, targetData.targetDate);
                // 距离目标剩余金额、预计达成日期：现场重算（与页面「开始计算」逻辑一致）
                const targetCalc = Utils.calcTargetStats(targetData.annualIncome, targetAmount, currentBalance);
                // 目标日期到今天的剩余月数（用于目标金额公式、每月最低收入）
                const months = Utils.calcMonths(targetData.targetDate);
                const remaining = targetCalc.remaining;

                const targetRows = [
                    ['【目标计划】'],
                    ['每年收入', (targetData.annualIncome ? Utils.formatNumber(targetData.annualIncome) + ' 元' : ''),
                        (targetData.annualIncome > 0 ? '(平均每月 ' + Utils.formatNumber(Math.round(targetData.annualIncome / 12)) + ' 元)' : '')],
                    ['收入说明', targetData.incomeRemark || ''],
                    ['每年支出', (targetData.annualExpense ? Utils.formatNumber(targetData.annualExpense) + ' 元' : ''),
                        (targetData.annualExpense > 0 ? '(平均每月 ' + Utils.formatNumber(Math.round(targetData.annualExpense / 12)) + ' 元)' : '')],
                    ['支出说明', targetData.expenseRemark || ''],
                    ['目标日期', Utils.formatDateToDot(targetData.targetDate || ''),
                        (months > 0 ? '（' + Utils.formatDuration(months) + '）' : '')],
                    ['目标金额', (targetAmount > 0 ? Utils.formatNumber(targetAmount) + ' 元' : ''),
                        (targetData.annualExpense && months > 0 ? '(' + Utils.formatNumber(targetData.annualExpense) + ' ÷ 12 × ' + months + ' 个月)' : '')],
                    ['目标说明', targetData.targetRemark || ''],
                    ['当前总余额', Utils.formatNumber(currentBalance) + ' 元'],
                ];

                // 距离目标剩余金额和截止日期（仅当收入和目标金额有效时显示）
                if (targetData.annualIncome > 0 && targetAmount > 0) {
                    targetRows.push(['（距离目标剩余金额和截止日期）', '按照当前收入和支出水平不变，不需要奋斗到目标日期，提前到什么时候可以达成目标？']);
                    targetRows.push(['距离目标剩余金额', Utils.formatNumber(remaining) + ' 元',
                        '(目标金额 ' + Utils.formatNumber(targetAmount) + ' - 当前余额 ' + Utils.formatNumber(currentBalance) + ')']);
                    targetRows.push(['剩余金额截止日期', targetCalc.targetDateDisplay,
                        (targetCalc.targetDuration ? '(还剩 ' + targetCalc.targetDuration + ')' : ''),
                        '(目标剩余金额 ' + Utils.formatNumber(remaining) + ' ÷ 每年收入 ' + Utils.formatNumber(targetData.annualIncome) + ')']);
                }

                // 距离目标日期每月最低收入（仅当剩余金额 > 0 且剩余月数 > 0 时显示）
                if (remaining > 0 && months > 0) {
                    const monthlyMin = Math.round(remaining / months);
                    const yearlyMin = Math.round(remaining / months * 12);
                    targetRows.push(['（距离目标日期每月最低收入）', '一直奋斗到目标日期，每个月收入不能低于多少钱？']);
                    targetRows.push(['每月最低收入', Utils.formatNumber(monthlyMin) + ' 元']);
                    targetRows.push(['每年最低收入(每月×12)', Utils.formatNumber(yearlyMin) + ' 元',
                        '从现在 到 ' + Utils.formatDateToDot(targetData.targetDate || '') + '，还剩下 ' + months + ' 个月',
                        '(目标剩余金额 ' + Utils.formatNumber(remaining) + ' ÷ 剩余总月份 ' + months + ' 个月)']);
                }

                targetRows.forEach(row => {
                    const escaped = row.map(val => {
                        if (typeof val === 'string' && (val.includes(',') || val.includes('\n') || val.includes('\r') || val.includes('"'))) {
                            return '"' + val.replace(/"/g, '""') + '"';
                        }
                        return val;
                    });
                    csv += escaped.join(',') + '\n';
                });

                // 目标计划与数据表格之间空一行
                csv += '\n';
            }

            // 2. 数据记录分区标题 + 表头
            csv += '【数据记录】\n';
            const headers = ['日期', '总余额', '对比差额', '总存款', '总负债'];
            configs.value.filter(f => !f.isDeleted).forEach(f => {
                if (f.category.includes('deposit')) headers.push(`${f.label}存款`);
                if (f.category.includes('debt')) headers.push(`${f.label}负债`);
            });
            headers.push('已删除汇总存款');
            headers.push('已删除汇总负债');
            headers.push('备注');

            // 3. 构建数据行
            const rows = sorted.map((item, index) => {
                // 对比差额：当前记录与下一条（日期更早）记录的余额差
                const prev = (index + 1 < sorted.length) ? sorted[index + 1] : null;
                const diff = prev ? getBalance(item) - getBalance(prev) : null;
                const row = [
                    Utils.formatDateToDot(item.date),
                    getBalance(item),
                    diff !== null ? diff : '-',
                    getTotalDeposit(item),
                    getTotalDebt(item),
                ];
                configs.value.filter(f => !f.isDeleted).forEach(f => {
                    if (f.category.includes('deposit')) row.push(Number(item[f.key + '_deposit']) || 0);
                    if (f.category.includes('debt')) row.push(Number(item[f.key + '_debt']) || 0);
                });
                row.push(getDeletedDepositTotal(item));
                row.push(getDeletedDebtTotal(item));
                row.push(item.remark || '');
                return row;
            });

            // 4. 拼接数据表格（追加到目标计划部分之后）
            const lines = [headers.join(',')];
            rows.forEach(row => {
                const escaped = row.map(val => {
                    if (typeof val === 'string') {
                        if (val.includes(',') || val.includes('\n') || val.includes('\r') || val.includes('"')) {
                            return '"' + val.replace(/"/g, '""') + '"';
                        }
                        return val;
                    }
                    return val;
                });
                lines.push(escaped.join(','));
            });

            // 5. 下载（添加 BOM 确保 Excel 正确识别 UTF-8）
            csv += lines.join('\n');
            const blob = new Blob(['\uFEFF' + csv], {type: 'text/csv;charset=utf-8;'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `账户数据_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('✅ CSV 导出成功');
        }

        async function exportJSON() {
            // 读取目标数据
            const targetData = await AccountData.loadTarget();

            // 仅目标有数据时也可导出；records/config/target 三者都为空的时候才提示
            if (records.value.length === 0 && configs.value.length === 0 && !targetData) {
                showToast('暂无数据可导出');
                return;
            }

            // 按日期降序排列
            const sortedForExport = [...records.value].sort((a, b) => b.date.localeCompare(a.date));

            const data = {
                version: VERSION_NUMBER,
                exportTime: new Date().toISOString(),
                config: configs.value,
                records: sortedForExport,
                target: targetData,
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `账户数据_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('✅ 导出成功');
        }

        // 导出方式选择弹窗状态
        // 操作栏「导出」按钮弹出选择，明确导出 JSON 还是 CSV，避免两个按钮挤在操作栏
        const exportModalVisible = ref(false);

        function openExportModal() {
            exportModalVisible.value = true;
        }

        function cancelExport() {
            exportModalVisible.value = false;
        }

        function doExport(type) {
            exportModalVisible.value = false;
            if (type === 'json') {
                exportJSON();
            } else {
                exportCSV();
            }
        }

        // 导入方式选择弹窗状态
        // 文件解析成功后先暂存数据，弹出「合并 / 覆盖」选择弹窗，用户确认后才真正写入。
        // 相比原生 confirm 的「确定=合并/取消=覆盖」，按钮语义更直白，避免误操作。
        const importModalVisible = ref(false);
        const importData = ref(null);   // 暂存解析后的导入数据
        const importStats = ref({});    // 文件统计信息，用于弹窗展示

        function triggerImport() {
            document.getElementById('fileInput').click();
        }

        function importJSON(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data.records || !Array.isArray(data.records)) {
                        showToast('❌ 无效的数据格式');
                        return;
                    }
                    // 解析成功：暂存数据，弹出「合并 / 覆盖」选择弹窗
                    importData.value = data;
                    importStats.value = {
                        records: data.records.length,
                        configs: data.config && Array.isArray(data.config) ? data.config.length : 0,
                        hasTarget: !!data.target,
                    };
                    importModalVisible.value = true;
                } catch (err) {
                    showToast('❌ JSON 解析失败');
                }
            };
            reader.readAsText(file);
            // 清空 input，允许重复选择同一文件
            event.target.value = '';
        }

        function cancelImport() {
            importModalVisible.value = false;
            importData.value = null;
        }

        async function doImport(mode) {
            const data = importData.value;
            if (!data) return;
            importModalVisible.value = false;
            importData.value = null;

            if (mode === 'merge') {
                // 合并导入：按日期去重，已有日期的记录覆盖更新
                let addedCount = 0;
                let updatedCount = 0;
                data.records.forEach(rec => {
                    const idx = records.value.findIndex(r => r.date === rec.date);
                    if (idx !== -1) {
                        records.value[idx] = rec;
                        updatedCount++;
                    } else {
                        records.value.push(rec);
                        addedCount++;
                    }
                });
                await saveData();
                // 合并银行卡配置：直接覆盖
                if (data.config && Array.isArray(data.config)) {
                    configs.value = data.config;
                    await AccountData.saveBankCardConfigs(configs.value);
                }
                // 合并目标：有则直接覆盖，并同步到目标表单
                if (data.target) {
                    await AccountData.saveTarget(data.target);
                    targetForm.value = {...targetForm.value, ...data.target};
                }
                showToast(`✅ 合并导入完成：新增 ${addedCount} 条，更新 ${updatedCount} 条`);
            } else {
                // 覆盖导入：清空当前数据，完全替换为文件内容
                if (data.config && Array.isArray(data.config)) {
                    configs.value = data.config;
                    await AccountData.saveBankCardConfigs(configs.value);
                } else {
                    configs.value = [];
                    await AccountData.saveBankCardConfigs([]);
                }
                records.value = data.records.slice();
                await saveData();
                if (data.target) {
                    await AccountData.saveTarget(data.target);
                    targetForm.value = {...targetForm.value, ...data.target};
                } else {
                    await AccountData.removeTarget();
                    targetForm.value = {
                        annualIncome: '', incomeRemark: '', annualExpense: '', expenseRemark: '',
                        targetAmount: 0, targetDate: '', targetRemark: '',
                        currentBalance: 0, remaining: 0, targetDateDisplay: '', targetDuration: ''
                    };
                }
                showToast(`✅ 覆盖导入完成：已导入 ${records.value.length} 条记录`);
            }
            currentPage.value = 1;
        }

        // Toast
        function showToast(msg) {
            if (toastTimer) clearTimeout(toastTimer);
            toastMsg.value = msg;
            toastTimer = setTimeout(() => {
                toastMsg.value = '';
                toastTimer = null;
            }, 2000);
        }

        // 数据持久化
        async function loadData() {
            const data = await AccountData.loadRecords();
            if (Array.isArray(data)) records.value = data;
        }

        async function saveData() {
            await AccountData.saveRecords(records.value);
        }

        // 刷新数据（重新从 localStorage 加载）
        async function refreshData() {
            await loadData();
            // 重新排序和分页会由 computed 自动触发
            showToast('✅ 数据已刷新');
        }

        // 表单工具
        function getDefaultForm() {
            const f = {date: '', remark: ''};
            configs.value.forEach(c => {
                if (c.category.includes('deposit')) f[c.key + '_deposit'] = '';
                if (c.category.includes('debt')) f[c.key + '_debt'] = '';
            });
            const now = new Date();
            f.date = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0');
            return f;
        }

        function filterNumber(key, event) {
            let val = event.target.value.replace(/[^0-9]/g, '');
            if (val === '') {
                form.value[key] = '';
            } else {
                const num = Number(val);
                if (!isNaN(num) && num >= 0) form.value[key] = num;
                else event.target.value = form.value[key] !== undefined ? form.value[key] : '';
            }
            event.target.value = form.value[key] !== undefined ? form.value[key] : '';
        }

        // 日期重复校验
        function isDateDuplicate(date, excludeIndex) {
            return records.value.some((r, i) => i !== excludeIndex && r.date === date);
        }

        // 记录操作
        function openAddModal() {
            // 没有可用的（未禁用、未删除）银行卡时，无法填写任何金额
            const availableCards = configs.value.filter(c => !c.disabled && !c.isDeleted);
            if (availableCards.length === 0) {
                showToast('⚠️ 请先配置银行卡（点击「银行卡管理」添加或启用）');
                return;
            }
            modalMode.value = 'add';
            editable.value = true;
            editIndex.value = -1;
            isCopy.value = false;
            copySourceIndex = -1;
            form.value = getDefaultForm();
            formSnapshot = JSON.stringify(form.value);
            prevRecord.value = null;
            modalVisible.value = true;
        }

        function openEditModal(item) {
            if (!item) return;
            const realIdx = records.value.findIndex(r => r.date === item.date);
            if (realIdx === -1) return;
            modalMode.value = 'edit';
            editable.value = false; // 默认查看态
            editIndex.value = realIdx;
            isCopy.value = false;
            form.value = {...records.value[realIdx]};
            formSnapshot = JSON.stringify(form.value);
            // 上一条（日期更早的相邻）记录，供详情逐卡对比上次金额/差额
            const sorted = sortedRecords.value;
            const sIdx = sorted.findIndex(r => r.date === item.date);
            prevRecord.value = (sIdx !== -1 && sIdx + 1 < sorted.length) ? sorted[sIdx + 1] : null;
            // 不修改全局开关 showPrevData：第一条记录只是没有上一条，
            // 复选框与对比区在模板里通过 prevRecord 判断隐藏，避免污染其他详情页持久化的开关
            bubbleKey.value = '';
            modalVisible.value = true;
        }

        // 取消编辑：恢复原始数据，退出编辑态
        function cancelEdit() {
            if (editable.value && JSON.stringify(form.value) !== formSnapshot) {
                if (!confirm('您有未保存的修改，确定要返回吗？')) return;
            }
            const idx = editIndex.value;
            if (idx >= 0 && idx < records.value.length) {
                form.value = {...records.value[idx]};
            }
            editable.value = false;
        }

        async function saveRecord() {
            const f = form.value;
            if (!f.date) {
                showToast('请选择日期');
                return;
            }

            // 日期重复校验
            const excludeIdx = modalMode.value === 'edit' ? editIndex.value : -1;
            if (isDateDuplicate(f.date, excludeIdx)) {
                showToast('❌ 该日期已有记录，不能重复');
                return;
            }

            // 检查是否有非零金额
            let hasValue = false;
            Object.keys(f).forEach(k => {
                if (k !== 'date' && k !== 'remark' && Number(f[k]) !== 0) hasValue = true;
            });
            if (!hasValue && !f.remark) {
                showToast('请至少填写一个金额或备注');
                return;
            }

            const clean = {date: f.date, remark: f.remark || ''};
            Object.keys(f).forEach(k => {
                if (k === 'date' || k === 'remark') return;
                // add 模式：跳过当前配置不含该类型的字段（复制带入的已取消类型数据不写入）
                if (modalMode.value === 'add') {
                    let cardKey = null, type = null;
                    if (k.endsWith('_deposit')) {
                        cardKey = k.slice(0, -8);
                        type = 'deposit';
                    } else if (k.endsWith('_debt')) {
                        cardKey = k.slice(0, -5);
                        type = 'debt';
                    }
                    if (cardKey) {
                        const card = configs.value.find(c => c.key === cardKey);
                        // 复制带入的历史字段：仅当银行卡未禁用、未删除且当前配置含该类型时才写入
                        if (!card || card.disabled || card.isDeleted || !card.category.includes(type)) return;
                    }
                }
                clean[k] = Number(f[k]) || 0;
            });

            if (modalMode.value === 'add') {
                records.value.push(clean);
                showToast('✅ 添加成功');
            } else {
                records.value[editIndex.value] = clean;
                showToast('✅ 更新成功');
            }
            await saveData();
            modalVisible.value = false;
            // add 模式：新记录按日期排最前，回到第一页便于查看
            // edit 模式：保留当前页，仅当当前页越界时修正到最后一页
            if (modalMode.value === 'add') {
                currentPage.value = 1;
            } else if (currentPage.value > totalPages.value) {
                currentPage.value = totalPages.value;
            }
        }

        // 复制当前记录：保留所有数据，日期设为今天，进入添加模式
        function copyRecord() {
            const data = {...form.value};
            copySourceIndex = editIndex.value;
            prevRecord.value = null;
            modalVisible.value = false;
            setTimeout(() => {
                modalMode.value = 'add';
                editIndex.value = -1;
                isCopy.value = true;
                const today = new Date();
                const y = today.getFullYear();
                const m = String(today.getMonth() + 1).padStart(2, '0');
                const d = String(today.getDate()).padStart(2, '0');
                data.date = `${y}-${m}-${d}`;
                form.value = data;
                formSnapshot = JSON.stringify(form.value);
                editable.value = true;
                modalVisible.value = true;
            }, 100);
        }

        // 取消复制：回到来源记录的查看态（有修改先确认）
        function cancelCopy() {
            if (isCopy.value && JSON.stringify(form.value) !== formSnapshot) {
                if (!confirm('您有未保存的修改，确定要返回吗？')) return;
            }
            if (copySourceIndex >= 0 && copySourceIndex < records.value.length) {
                // 复用查看态打开逻辑：同步重建上一条对比、气泡状态与表单快照
                openEditModal(records.value[copySourceIndex]);
            } else {
                modalVisible.value = false;
            }
        }

        async function deleteRecord() {
            if (confirm('确定删除该记录？')) {
                records.value.splice(editIndex.value, 1);
                await saveData();
                modalVisible.value = false;
                showToast('🗑 已删除');
                // 删除后若当前页已无数据，则回退一页
                if (currentPage.value > totalPages.value) currentPage.value = totalPages.value;
            }
        }

        // 关闭记录弹窗前确认未保存的修改（仅当内容相对打开时快照有变化才提示）
        function confirmClose() {
            let needConfirm = false;
            if (modalMode.value === 'add' || (modalMode.value === 'edit' && editable.value)) {
                if (JSON.stringify(form.value) !== formSnapshot) {
                    needConfirm = true;
                }
            }
            if (needConfirm) {
                if (confirm('您有未保存的修改，确定要关闭吗？')) {
                    modalVisible.value = false;
                }
            } else {
                modalVisible.value = false;
            }
        }

        // 银行卡管理
        function openBankCardManager() {
            bankManagerVisible.value = true;
        }

        function openAddBankCard() {
            bankFormMode.value = 'add';
            bankForm.value = {key: '', label: '', category: ['deposit', 'debt'], showInList: true, remark: ''};
            editingCardKey.value = '';
            bankFormVisible.value = true;
        }

        function openEditBankCard(card) {
            bankFormMode.value = 'edit';
            bankForm.value = {...card, showInList: card.showInList !== false, remark: card.remark || '', originalCategory: [...card.category]};
            editingCardKey.value = card.key;
            bankFormVisible.value = true;
        }

        async function saveBankCard() {
            const label = bankForm.value.label.trim();
            if (!label) {
                showToast('请输入名称');
                return;
            }
            if (bankForm.value.category.length === 0) {
                showToast('请至少选择一种类型');
                return;
            }

            // 检查重名（编辑时排除自己）
            const exist = configs.value.find(f => f.label === label);
            if (exist && (bankFormMode.value === 'add' || (bankFormMode.value === 'edit' && exist.key !== editingCardKey.value))) {
                showToast('名称已存在');
                return;
            }

            // 编辑模式下取消了部分类型，需确认（历史数据不丢失，仍计入总存款/总负债）
            if (bankFormMode.value === 'edit' && bankForm.value.originalCategory) {
                const removedTypes = bankForm.value.originalCategory.filter(t => !bankForm.value.category.includes(t));
                if (removedTypes.length > 0) {
                    const typeMap = {deposit: '存款', debt: '负债'};
                    const removedNames = removedTypes.map(t => typeMap[t] || t).join('、');
                    if (!confirm(`您取消了"${removedNames}"类型，历史数据不会丢失，仍然会计入总存款/总负债；但后续新增记录将无法填写该类型。\n确定继续保存吗？`)) {
                        return;
                    }
                }
            }

            if (bankFormMode.value === 'add') {
                configs.value.push({
                    key: Utils.generateKey(),
                    label: label,
                    category: [...bankForm.value.category],
                    disabled: false,
                    showInList: bankForm.value.showInList !== false,
                    remark: bankForm.value.remark || '',
                });
                showToast('✅ 银行卡已添加');
            } else {
                const idx = configs.value.findIndex(f => f.key === editingCardKey.value);
                if (idx === -1) {
                    showToast('数据异常');
                    return;
                }
                configs.value[idx].label = label;
                configs.value[idx].category = [...bankForm.value.category];
                configs.value[idx].showInList = bankForm.value.showInList !== false;
                configs.value[idx].remark = bankForm.value.remark || '';
                showToast('✅ 银行卡已更新');
            }
            await AccountData.saveBankCardConfigs(configs.value);
            bankFormVisible.value = false;
        }

        // 删除银行卡（软删除：标记 isDeleted，历史数据保留，可到回收站恢复）
        async function deleteBankCard() {
            const cardKey = editingCardKey.value;
            const card = configs.value.find(f => f.key === cardKey);
            if (!card) {
                showToast('❌ 银行卡不存在');
                return;
            }
            if (!confirm(`确定要删除银行卡「${card.label}」吗？\n历史数据保留，可到回收站恢复。`)) {
                return;
            }
            await softDeleteBankCard(configs.value, cardKey);
            bankFormVisible.value = false;
            showToast(`✅ 已删除银行卡「${card.label}」`);
        }

        async function toggleBankCardDisabled(key) {
            const card = configs.value.find(f => f.key === key);
            if (!card) return false;
            const newState = !card.disabled;
            const action = newState ? '禁用' : '启用';
            let msg = `确定要${action}「${card.label}」吗？`;
            if (newState) {
                msg += '\n\n🚫 禁用后：\n• 添加记录时不再显示该银行卡\n• 列表中将隐藏该银行卡列\n• 历史记录仍可查看和编辑（不会丢失数据）';
            } else {
                msg += '\n\n✅ 启用后：\n• 添加记录时可重新使用该银行卡\n• 列表中将重新显示该银行卡列';
            }
            if (confirm(msg)) {
                card.disabled = newState;
                await AccountData.saveBankCardConfigs(configs.value);
                showToast(`✅ 已${action}「${card.label}」`);
                return true;
            }
            return false;
        }

        // 编辑银行卡弹窗内切换禁用/启用，成功后关闭弹窗回管理列表
        async function toggleDisabledFromForm() {
            if (await toggleBankCardDisabled(bankForm.value.key)) {
                bankFormVisible.value = false;
            }
        }

        // 回收站列表：已软删除的银行卡
        const deletedCards = computed(() => configs.value.filter(c => c.isDeleted));

        /**
         * 手动调整银行卡顺序（在当前列表内上移/下移一位，交换 configs 数组下标并整体持久化）
         * @param list 当前渲染的卡列表（管理面板传 activeCards，回收站传 deletedCards）
         * @param idx 当前项下标
         * @param dir -1 上移 / 1 下移
         */
        async function moveCard(list, idx, dir) {
            const swapIdx = idx + dir;
            if (swapIdx < 0 || swapIdx >= list.length) return;
            const arr = configs.value;
            const ia = arr.findIndex(c => c.key === list[idx].key);
            const ib = arr.findIndex(c => c.key === list[swapIdx].key);
            if (ia < 0 || ib < 0) return;
            const temp = arr[ia];
            arr[ia] = arr[ib];
            arr[ib] = temp;
            await AccountData.saveBankCardConfigs(configs.value);
        }

        function openRecycleBin() {
            recycleBinVisible.value = true;
        }

        function closeRecycleBin() {
            recycleBinVisible.value = false;
        }

        // 恢复银行卡：软删除标记还原，历史记录中的对应数据自动恢复
        async function restoreCard(card) {
            const restored = await restoreBankCard(configs.value, card.key);
            if (!restored) {
                showToast('❌ 银行卡不存在');
                return;
            }
            showToast(`✅ 已恢复银行卡「${restored.label}」，历史数据同步恢复`);
        }

        // 请求彻底删除：打开红色警示确认弹窗（入口按钮默认注释，逻辑保留）
        function requestPermanentDelete(card) {
            recycleTargetCard.value = card;
            recycleConfirmVisible.value = true;
        }

        function cancelPermanentDelete() {
            recycleConfirmVisible.value = false;
            recycleTargetCard.value = null;
        }

        // 确认彻底删除：输入指定文字后执行，不可恢复
        async function confirmPermanentDelete() {
            const card = recycleTargetCard.value;
            if (!card) return;
            const userInput = prompt('请键入「确定彻底删除银行卡」以确认彻底删除：');
            if (userInput !== '确定彻底删除银行卡') {
                showToast('❌ 输入错误，取消删除');
                recycleConfirmVisible.value = false;
                recycleTargetCard.value = null;
                return;
            }
            recycleConfirmVisible.value = false;
            recycleTargetCard.value = null;

            const result = await permanentDeleteBankCard(configs.value, records.value, card.key);
            if (!result) {
                showToast('❌ 银行卡不存在');
                return;
            }
            showToast(`✅ 已彻底删除「${result.label}」，其历史数据共 ${result.removedCount} 条已清除`);
        }

        // 关闭银行卡表单弹窗：仅当内容相对原配置有变化才提示
        function closeBankCardForm() {
            let isDirty = false;

            if (bankFormMode.value === 'edit') {
                const orig = bankForm.value.originalCategory || [];
                const current = bankForm.value.category || [];
                // 类型是否有变化
                if (orig.length !== current.length || orig.some(t => current.indexOf(t) === -1)) {
                    isDirty = true;
                }
                const card = configs.value.find(c => c.key === editingCardKey.value);
                // 名称是否有变化
                if (card && bankForm.value.label.trim() !== card.label) {
                    isDirty = true;
                }
                // 备注是否有变化
                if (card && (bankForm.value.remark || '') !== (card.remark || '')) {
                    isDirty = true;
                }
                // 列表显示状态是否有变化
                if (card && bankForm.value.showInList !== (card.showInList !== false)) {
                    isDirty = true;
                }
            }

            if (bankFormMode.value === 'add') {
                // 添加模式：填了名称或备注才算有内容
                if (bankForm.value.label.trim() !== '' || bankForm.value.remark.trim() !== '') {
                    isDirty = true;
                }
            }

            if (isDirty) {
                if (!confirm('您有未保存的修改，确定要关闭吗？')) {
                    return;
                }
            }
            bankFormVisible.value = false;
            bankForm.value.originalCategory = [];
        }

        // 清空所有数据，谨慎操作！二次确认 + 输入指定文字防误触
        async function clearData() {
            if (!confirm('确认清空所有数据？此操作不可恢复！')) return;
            const userInput = prompt('请键入「确认清空所有数据」以确认清空：');
            if (userInput !== '确认清空所有数据') {
                showToast('❌ 输入错误，取消清空');
                return;
            }
            await AccountData.clearAll();
            location.reload();
        }

        // 目标计划
        /**
         * 打开目标计划弹窗
         * 从 localStorage 加载目标数据，最新一条记录的总余额作为当前余额
         */
        async function openTargetModal() {
            const data = await AccountData.loadTarget();
            if (data) {
                targetForm.value = {...targetForm.value, ...data};
            }
            // 最新一条记录（日期最新）的总余额作为当前余额
            const sorted = sortedRecords.value;
            const latest = sorted.length ? sorted[0] : null;
            targetForm.value.currentBalance = latest ? getBalance(latest) : 0;
            targetCalculated.value = false;
            targetEditable.value = false;
            targetSnapshot = JSON.stringify(targetForm.value);
            targetModalVisible.value = true;
        }

        function closeTargetModal() {
            // 编辑态且内容相对打开时快照有变化才提示
            if (targetEditable.value && JSON.stringify(targetForm.value) !== targetSnapshot) {
                if (!confirm('您有未保存的修改，确定要关闭吗？')) return;
            }
            targetModalVisible.value = false;
        }

        /**
         * 计算"距离目标剩余"和"预计达成日期"
         */
        function calcTarget() {
            const annual = Number(targetForm.value.annualIncome) || 0;
            const target = Utils.calcTargetAmount(targetForm.value.annualExpense, targetForm.value.targetDate); // 实时计算
            const current = Number(targetForm.value.currentBalance) || 0;
            if (target <= 0 || annual <= 0) {
                showToast('请先填写有效的每年收入和目标金额');
                return;
            }

            targetForm.value.targetAmount = target; // 仅用于计算结果快照展示，不存到存储
            // 复用公共计算函数（与 CSV 导出逻辑一致）
            const result = Utils.calcTargetStats(annual, target, current);
            targetForm.value.remaining = result.remaining;
            targetForm.value.targetDateDisplay = result.targetDateDisplay;
            targetForm.value.targetDuration = result.targetDuration;
            targetCalculated.value = true;
        }

        /**
         * 保存目标计划数据
         */
        async function saveTarget() {
            try {
                // 使用公共函数构建完整数据（目标金额实时计算，不写入存储）
                const data = Utils.buildTargetData(targetForm.value);
                await AccountData.saveTarget(data);

                showToast('✅ 目标已保存');
                targetEditable.value = false;
            } catch (_) {
                showToast('❌ 保存失败');
            }
        }

        /**
         * 进入目标编辑态
         */
        function enableTargetEdit() {
            targetEditable.value = true;
            targetCalculated.value = false; // 进入编辑态隐藏计算结果
        }

        /**
         * 取消目标编辑：放弃修改，重载已保存数据
         */
        async function cancelTargetEdit() {
            if (targetEditable.value && JSON.stringify(targetForm.value) !== targetSnapshot) {
                if (!confirm('您有未保存的修改，确定要返回吗？')) return;
            }
            const data = await AccountData.loadTarget();
            if (data) {
                targetForm.value = {...targetForm.value, ...data};
            }
            targetEditable.value = false;
            targetCalculated.value = false;
        }

        /**
         * 备注展开/收起
         */
        function toggleRemark() {
            showRemark.value = !showRemark.value;
        }

        onMounted(async () => {
            // 异步加载所有数据
            configs.value = await AccountData.loadBankCardConfigs();
            await loadData();
            const targetData = await AccountData.loadTarget();
            if (targetData) {
                targetForm.value = {...targetForm.value, ...targetData};
            }
            // 界面偏好：合并默认值后恢复三个开关
            const savedPrefs = await AccountData.loadUIPrefs();
            const prefs = Object.assign({}, DEFAULT_UI_PREFS, savedPrefs);
            showPrevData.value = prefs.showPrevData === true;
            showRemark.value = prefs.showRemark === true;
            targetReminderExpanded.value = prefs.targetReminderExpanded === true;

            // 界面偏好持久化：对比上次、备注、目标提醒展开状态变化即保存
            watch([showPrevData, showRemark, targetReminderExpanded], () => {
                AccountData.saveUIPrefs({
                    showPrevData: showPrevData.value,
                    showRemark: showRemark.value,
                    targetReminderExpanded: targetReminderExpanded.value
                });
            });
            // 编辑态刷新/关闭页面时拦截，防止未保存输入丢失
            // 纯浏览态（查看记录、银行卡列表）不拦截，刷新不会丢数据
            window.addEventListener('beforeunload', function (e) {
                const recordEditing = modalVisible.value
                    && (modalMode.value === 'add' || (modalMode.value === 'edit' && editable.value));
                const targetEditing = targetModalVisible.value && targetEditable.value;
                const editing = recordEditing || bankFormVisible.value || targetEditing;
                if (editing) {
                    e.preventDefault();
                    e.returnValue = '';
                }
            });
        });

        return {
            records,
            sortedRecords,
            modalVisible,
            modalMode,
            editable,
            isCopy,
            form,
            showRemark,
            displayFields,
            prevRecord,
            showPrevData,
            bubbleKey,
            allConfigs,
            activeCards,
            editableFields,
            bankManagerVisible,
            bankFormVisible,
            bankFormMode,
            bankForm,
            toastMsg,
            confirmClose,
            closeBankCardForm,
            clearData,

            getFieldValue,
            getTotalDeposit,
            getTotalDebt,
            getBalance,
            getPrevData,
            toggleBubble,
            toggleShowPrev,
            prevDateText,
            formatSigned,
            getDeletedDepositTotal,
            getDeletedDebtTotal,
            hasDeletedFields,
            getDiff,
            formatNumber: Utils.formatNumber,
            formatDateToDot: Utils.formatDateToDot,
            shouldShowFieldInModal,
            shouldShowTypeField,

            openAddModal,
            openEditModal,
            cancelEdit,
            saveRecord,
            deleteRecord,
            copyRecord,
            cancelCopy,
            filterNumber,
            refreshData,

            openBankCardManager,
            openAddBankCard,
            openEditBankCard,
            saveBankCard,
            toggleBankCardDisabled,
            toggleDisabledFromForm,
            deleteBankCard,
            deletedCards,
            moveCard,
            openRecycleBin,
            closeRecycleBin,
            restoreCard,
            requestPermanentDelete,
            cancelPermanentDelete,
            confirmPermanentDelete,
            recycleBinVisible,
            recycleConfirmVisible,
            recycleTargetCard,

            // 分页
            currentPage,
            totalPages,
            paginatedRecords,
            prevPage,
            nextPage,
            jumpPage,
            goToPage,

            // 导出和导入
            exportCSV,
            exportJSON,
            exportModalVisible,
            openExportModal,
            cancelExport,
            doExport,
            triggerImport,
            importJSON,
            importModalVisible,
            importStats,
            importData,
            cancelImport,
            doImport,

            // 全屏
            toggleFullscreen,

            // 目标
            targetModalVisible,
            targetEditable,
            targetReminderExpanded,
            targetForm,
            targetCalculated,
            computedTargetAmount,
            computedMonths,
            computedDurationFromMonths,
            openTargetModal,
            closeTargetModal,
            calcTarget,
            saveTarget,
            enableTargetEdit,
            cancelTargetEdit,
            toggleRemark,
        };
    }
});

app.mount('#app');
