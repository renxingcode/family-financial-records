const {createApp, ref, computed, onMounted, watch} = Vue;

// 配置 & 存储
/**
 * VERSION_NUMBER: 数据格式版本号
 * 用于标识导出 JSON 的数据结构版本，仅在数据格式发生不兼容变更时递增。
 * 当前版本：1.0 - 稳定数据结构（card_xxx_deposit / card_xxx_debt 扁平结构）
 */
const VERSION_NUMBER = 1.0;

/**
 * STORAGE_KEYS: localStorage 存储键名统一管理
 * 各模块数据的读写统一从这里取键名，避免散落魔法字符串。
 * RECORDS: 账目记录（Array<{ date, remark, card_xxx_deposit, card_xxx_debt, ... }>）
 * BANK_CARD_CONFIGS: 银行卡配置（Array<{ key, label, category, disabled }>）
 * TARGET: 目标计划（Object<{ annualIncome, incomeRemark, annualExpense, targetDate, targetRemark, ... }>，targetAmount 实时计算不存储）
 */
var STORAGE_KEYS = {
    RECORDS: 'financial_account_records',
    BANK_CARD_CONFIGS: 'financial_account_bank_card_configs',
    TARGET: 'financial_account_target'
};

function loadConfig() {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.BANK_CARD_CONFIGS);
        if (raw) {
            const data = JSON.parse(raw);
            if (Array.isArray(data) && data.length) return data;
        }
    } catch (_) {
    }
    return [];
}

function saveConfig(config) {
    localStorage.setItem(STORAGE_KEYS.BANK_CARD_CONFIGS, JSON.stringify(config));
}

function generateKey() {
    return 'card_' + Date.now();
}

/**
 * 软删除银行卡（标记 isDeleted，历史数据保留）
 * @param {Array} configs 银行卡配置数组
 * @param {string} key 银行卡 key
 * @returns {boolean} 是否删除成功
 */
function softDeleteBankCard(configs, key) {
    const card = configs.find(c => c.key === key);
    if (!card) return false;
    card.isDeleted = true;
    saveConfig(configs);
    return true;
}

/**
 * 恢复银行卡：软删除标记还原，历史数据自动恢复显示
 * @param {Array} configs 银行卡配置数组
 * @param {string} key 银行卡 key
 * @returns {Object|null} 恢复后的银行卡配置；不存在时返回 null
 */
function restoreBankCard(configs, key) {
    const card = configs.find(c => c.key === key);
    if (!card) return null;
    card.isDeleted = false;
    card.showInList = true; // 恢复后默认重新显示在列表中
    saveConfig(configs);
    return card;
}

/**
 * 彻底删除银行卡：从配置中移除，并清除所有历史记录中该卡字段。不可恢复。
 * @param {Array} configs 银行卡配置数组
 * @param {Array} records 账户记录数组
 * @param {string} key 银行卡 key
 * @returns {Object|null} {label, removedCount}；不存在时返回 null
 */
function permanentDeleteBankCard(configs, records, key) {
    const card = configs.find(c => c.key === key);
    if (!card) return null;
    const label = card.label;

    const idx = configs.findIndex(c => c.key === key);
    if (idx !== -1) configs.splice(idx, 1);
    saveConfig(configs);

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
        localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
    }
    return {label: label, removedCount: removedCount};
}

// 目标相关公共函数
/**
 * 计算从今天到目标日期的剩余月数（四舍五入到月）
 * @param {string} targetDateStr - 目标日期字符串 'YYYY-MM-DD'
 * @returns {number} 剩余月数，如果日期无效或已过期返回 0
 */
function calcMonths(targetDateStr) {
    if (!targetDateStr) return 0;
    const now = new Date();
    const target = new Date(targetDateStr);
    if (target <= now) return 0;
    const months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
    const days = target.getDate() - now.getDate();
    // 如果天数超过 15 天，视为多一个月（四舍五入）
    return months + (days > 15 ? 1 : 0);
}

/**
 * 计算目标金额：每年支出 ÷ 12 × 剩余月数
 * @param {number|string} annualExpense - 每年支出
 * @param {string} targetDateStr - 目标日期字符串
 * @returns {number} 目标金额，四舍五入到整数
 */
function calcTargetAmount(annualExpense, targetDateStr) {
    const expense = Number(annualExpense) || 0;
    const months = calcMonths(targetDateStr);
    if (expense <= 0 || months <= 0) return 0;
    return Math.round((expense / 12) * months);
}

/**
 * 构建完整的目标数据对象（统一数据结构）
 * @param {Object} form - targetForm 对象
 * @returns {Object} 包含所有目标字段的完整数据对象
 */
function buildTargetData(form) {
    return {
        annualIncome: form.annualIncome || '',   // 每年收入，用户填写
        incomeRemark: form.incomeRemark || '',   // 每年收入补充说明，用户填写
        annualExpense: form.annualExpense || '', // 每年支出，用户填写
        expenseRemark: form.expenseRemark || '', // 每年支出说明，用户填写
        targetDate: form.targetDate || '',       // 目标日期，用户填写
        targetRemark: form.targetRemark || ''    // 目标说明，用户填写
    };
}

/**
 * 格式化剩余月数为「X年X个月之后」
 * @param {number} months - 月数
 * @returns {string} 格式化的字符串
 */
function formatDuration(months) {
    if (months <= 0) return '';
    const years = Math.floor(months / 12);
    const remainMonths = months % 12;
    let result = '';
    if (years > 0) result += years + '年';
    if (remainMonths > 0) result += remainMonths + '个月';
    return result + '之后';
}

/**
 * 日期格式化为点分格式 'YYYY-MM-DD' -> 'YYYY.MM.DD'
 * @param {string} dateStr - 日期字符串
 * @returns {string} 点分格式的日期
 */
function formatDateToDot(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return parts[0] + '.' + parts[1] + '.' + parts[2];
    }
    return dateStr;
}

/**
 * 计算距离目标统计：剩余金额、预计达成日期、达成所需时长
 * @param {number|string} annualIncome - 每年收入
 * @param {number|string} targetAmount - 目标金额
 * @param {number|string} currentBalance - 当前总余额
 * @returns {{remaining: number, targetDateDisplay: string, targetDuration: string}}
 */
function calcTargetStats(annualIncome, targetAmount, currentBalance) {
    const income = Number(annualIncome) || 0;
    const target = Number(targetAmount) || 0;
    const current = Number(currentBalance) || 0;

    if (target <= 0 || income <= 0) {
        return {remaining: 0, targetDateDisplay: '请填写有效数据', targetDuration: ''};
    }

    const remaining = target - current;
    const monthlyIncome = income / 12;

    if (remaining > 0 && monthlyIncome > 0) {
        const monthsNeeded = Math.round(remaining / monthlyIncome);
        const now = new Date();
        const targetDate = new Date(now);
        targetDate.setMonth(now.getMonth() + monthsNeeded);
        const targetYear = targetDate.getFullYear();
        const targetMonth = targetDate.getMonth() + 1;
        const dateDisplay = `${targetYear}年${String(targetMonth).padStart(2, '0')}月`;

        const years = Math.floor(monthsNeeded / 12);
        const monthsRemain = monthsNeeded % 12;
        let duration = '';
        if (years > 0) duration += years + '年';
        if (monthsRemain > 0) duration += monthsRemain + '个月';
        if (!duration) duration = '不足1个月';

        return {remaining, targetDateDisplay: dateDisplay, targetDuration: duration};
    } else {
        return {remaining, targetDateDisplay: '已达成或无法计算', targetDuration: ''};
    }
}

const app = createApp({
    setup() {
        // 数据
        const records = ref([]);
        const configs = ref(loadConfig());

        // 响应式：分页
        const currentPage = ref(1);         // 当前页码
        const pageSize = 10;                // 每页显示记录数

        // Toast
        const toastMsg = ref('');
        let toastTimer = null;

        // 记录弹窗
        const modalVisible = ref(false);
        const modalMode = ref('add');   // 'add' | 'edit'
        const editable = ref(false);    // 编辑态（true）还是查看态（false）
        const editIndex = ref(-1);
        const form = ref({});
        const showRemark = ref(false);  // 备注输入框是否展开（编辑态）

        // 银行卡管理
        const bankManagerVisible = ref(false);
        const bankFormVisible = ref(false);
        const bankFormMode = ref('add');  // 'add' | 'edit'
        const bankForm = ref({key: '', label: '', category: ['deposit', 'debt'], showInList: true});
        const editingCardKey = ref('');
        const bankFormModified = ref(false); // 标记银行卡表单是否被修改过

        // 回收站
        const recycleBinVisible = ref(false);
        const recycleConfirmVisible = ref(false); // 彻底删除红色警示确认弹窗
        const recycleTargetCard = ref(null);      // 待彻底删除的银行卡

        // 目标
        const targetModalVisible = ref(false);
        const targetEditable = ref(false);
        const targetReminderExpanded = ref(false);
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
        // 旧版目标数据检测（有目标金额但缺每年支出，提示用户补充）
        const legacyTargetDetected = ref(false);

        // 计算
        /**
         * 计算距离目标日期的剩余月数（超过 15 天算一个月）
         */
        const computedMonths = computed(() => {
            return calcMonths(targetForm.value.targetDate);
        });

        /**
         * 目标金额自动计算（每年支出 ÷ 12 × 剩余月数）
         */
        const computedTargetAmount = computed(() => {
            return calcTargetAmount(targetForm.value.annualExpense, targetForm.value.targetDate);
        });

        /**
         * 将月数格式化为「X年X个月之后」
         */
        const computedDurationFromMonths = computed(() => {
            return formatDuration(computedMonths.value);
        });

        /**
         * 旧版数据折算的每年支出参考值（目标金额 × 12 ÷ 剩余月数）
         */
        const legacySuggestedExpense = computed(() => {
            if (!legacyTargetDetected.value || computedMonths.value <= 0) return 0;
            return Math.round((Number(targetForm.value.targetAmount) || 0) * 12 / computedMonths.value);
        });

        // displayFields: 列表中实际显示的银行卡列（禁用、隐藏或已删除的不显示）
        const displayFields = computed(() => {
            return configs.value.filter(f => !f.disabled && !f.isDeleted && f.showInList !== false);
        });
        const allConfigs = computed(() => configs.value);
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
         * @param {number} idxInPage - 当前页中的索引
         * @returns {number|null} 差额（当前余额 - 上一条余额），如果没有上一条则返回 null
         */
        function getDiff(item, idxInPage) {
            const realIdx = sortedRecords.value.indexOf(item);
            if (realIdx === -1 || realIdx + 1 >= sortedRecords.value.length) return null;
            const prev = sortedRecords.value[realIdx + 1];
            return getBalance(item) - getBalance(prev);
        }

        /**
         * 格式化数字，添加千位分隔符
         * 例如：3200 → "3,200"
         */
        function formatNumber(num) {
            if (num === undefined || num === null || isNaN(num)) return num;
            return Number(num).toLocaleString('en-US');
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
        }

        function nextPage() {
            if (currentPage.value < totalPages.value) currentPage.value++;
        }

        // 全屏
        function toggleFullscreen() {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen?.() || document.documentElement.webkitRequestFullscreen?.();
            } else {
                document.exitFullscreen?.() || document.webkitExitFullscreen?.();
            }
        }

        function exportCSV() {
            if (records.value.length === 0) {
                showToast('暂无数据');
                return;
            }

            // 按日期降序排列
            const sorted = [...records.value].sort((a, b) => b.date.localeCompare(a.date));

            // 1. 构建目标计划部分（若已设置目标）
            let csv = '';

            // 读取目标数据
            let targetData = null;
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.TARGET);
                if (raw) targetData = JSON.parse(raw);
            } catch (_) {
            }

            if (targetData) {
                // 当前总余额：取最新一条记录的余额
                const latest = sorted[0];
                const currentBalance = latest ? getBalance(latest) : 0;
                // 目标金额实时计算（每年支出 ÷ 12 × 剩余月数）
                const targetAmount = calcTargetAmount(targetData.annualExpense, targetData.targetDate);
                // 剩余金额与预计达成日期：现场重算（与页面「开始计算」逻辑一致，不依赖页面状态）
                const targetCalc = calcTargetStats(targetData.annualIncome, targetAmount, currentBalance);

                const targetRows = [
                    ['每年收入', targetData.annualIncome || ''],
                    ['每年收入说明', targetData.incomeRemark || ''],
                    ['每年支出', targetData.annualExpense || ''],
                    ['每年支出说明', targetData.expenseRemark || ''],
                    ['目标日期', targetData.targetDate || ''],
                    ['目标金额', targetAmount],
                    ['目标说明', targetData.targetRemark || ''],
                    ['当前总余额', currentBalance],
                    ['剩余金额', targetCalc.remaining],
                    ['预计达成日期', targetCalc.targetDateDisplay],
                    ['剩余时间', targetCalc.targetDuration]
                ];

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

            // 2. 构建表头
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
                    item.date,
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

        function exportJSON() {
            if (records.value.length === 0 && configs.value.length === 0) {
                showToast('暂无数据');
                return;
            }

            // 读取目标数据
            let targetData = null;
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.TARGET);
                if (raw) targetData = JSON.parse(raw);
            } catch (_) {
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

        function doImport(mode) {
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
                saveData();
                // 合并银行卡配置：直接覆盖
                if (data.config && Array.isArray(data.config)) {
                    configs.value = data.config;
                    saveConfig(configs.value);
                }
                // 合并目标：有则直接覆盖
                if (data.target) {
                    localStorage.setItem(STORAGE_KEYS.TARGET, JSON.stringify(data.target));
                }
                showToast(`✅ 合并导入完成：新增 ${addedCount} 条，更新 ${updatedCount} 条`);
            } else {
                // 覆盖导入：清空当前数据，完全替换为文件内容
                if (data.config && Array.isArray(data.config)) {
                    configs.value = data.config;
                    saveConfig(configs.value);
                } else {
                    configs.value = [];
                    saveConfig([]);
                }
                records.value = data.records.slice();
                saveData();
                if (data.target) {
                    localStorage.setItem(STORAGE_KEYS.TARGET, JSON.stringify(data.target));
                } else {
                    localStorage.removeItem(STORAGE_KEYS.TARGET);
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
        function loadData() {
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.RECORDS);
                if (raw) {
                    const data = JSON.parse(raw);
                    if (Array.isArray(data)) records.value = data;
                }
            } catch (_) {
            }
        }

        function saveData() {
            localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records.value));
        }

        // 刷新数据（重新从 localStorage 加载）
        function refreshData() {
            loadData();
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
            if (configs.value.length === 0) {
                showToast('⚠️ 请先添加银行卡');
                return;
            }
            modalMode.value = 'add';
            editable.value = true;
            editIndex.value = -1;
            form.value = getDefaultForm();
            showRemark.value = false;
            modalVisible.value = true;
        }

        function openEditModal(item, idx) {
            if (!item) return;
            const realIdx = records.value.findIndex(r => r.date === item.date);
            if (realIdx === -1) return;
            modalMode.value = 'edit';
            editable.value = false; // 默认查看态
            editIndex.value = realIdx;
            form.value = {...records.value[realIdx]};
            showRemark.value = !!form.value.remark; // 有备注默认展开
            modalVisible.value = true;
        }

        // 取消编辑：恢复原始数据，退出编辑态
        function cancelEdit() {
            if (editable.value) {
                if (!confirm('您有未保存的修改，确定要返回吗？')) return;
            }
            const idx = editIndex.value;
            if (idx >= 0 && idx < records.value.length) {
                form.value = {...records.value[idx]};
            }
            editable.value = false;
        }

        function saveRecord() {
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
            saveData();
            modalVisible.value = false;
        }

        // 复制当前记录：保留所有数据，日期设为今天，进入添加模式
        function copyRecord() {
            const data = {...form.value};
            modalVisible.value = false;
            setTimeout(() => {
                modalMode.value = 'add';
                editIndex.value = -1;
                const today = new Date();
                const y = today.getFullYear();
                const m = String(today.getMonth() + 1).padStart(2, '0');
                const d = String(today.getDate()).padStart(2, '0');
                data.date = `${y}-${m}-${d}`;
                form.value = data;
                editable.value = true;
                showRemark.value = false;
                modalVisible.value = true;
            }, 100);
        }

        function deleteRecord() {
            if (confirm('确定删除该记录？')) {
                records.value.splice(editIndex.value, 1);
                saveData();
                modalVisible.value = false;
                showToast('🗑 已删除');
                // 删除后若当前页已无数据，则回退一页
                if (currentPage.value > totalPages.value) currentPage.value = totalPages.value;
            }
        }

        // 关闭记录弹窗前确认未保存的修改
        function confirmClose() {
            let needConfirm = false;
            if (modalMode.value === 'add') {
                // 检查是否有填写内容（日期、金额、备注）
                const f = form.value;
                const hasDate = !!f.date;
                let hasAmount = false;
                Object.keys(f).forEach(k => {
                    if (k !== 'date' && k !== 'remark' && Number(f[k]) !== 0) hasAmount = true;
                });
                const hasRemark = !!f.remark;
                if (hasDate || hasAmount || hasRemark) {
                    needConfirm = true;
                }
            } else if (modalMode.value === 'edit' && editable.value) {
                needConfirm = true;
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
            bankFormModified.value = false;
            bankFormVisible.value = true;
        }

        function openEditBankCard(card) {
            bankFormMode.value = 'edit';
            bankForm.value = {...card, showInList: card.showInList !== false, remark: card.remark || '', originalCategory: [...card.category]};
            editingCardKey.value = card.key;
            bankFormModified.value = false;
            bankFormVisible.value = true;
        }

        function saveBankCard() {
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
                    key: generateKey(),
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
            saveConfig(configs.value);
            bankFormModified.value = false;
            bankFormVisible.value = false;
        }

        // 删除银行卡（软删除：标记 isDeleted，历史数据保留，可到回收站恢复）
        function deleteBankCard() {
            const cardKey = editingCardKey.value;
            const card = configs.value.find(f => f.key === cardKey);
            if (!card) {
                showToast('❌ 银行卡不存在');
                return;
            }
            if (!confirm(`确定要删除银行卡「${card.label}」吗？\n历史数据保留，可到回收站恢复。`)) {
                return;
            }
            softDeleteBankCard(configs.value, cardKey);
            bankFormVisible.value = false;
            showToast(`✅ 已删除银行卡「${card.label}」`);
        }

        function toggleBankCardDisabled(key) {
            const card = configs.value.find(f => f.key === key);
            if (!card) return;
            const newState = !card.disabled;
            const action = newState ? '禁用' : '启用';
            if (confirm(`确定要${action}「${card.label}」吗？${newState ? '禁用的银行卡在添加记录时不再显示' : ''}`)) {
                card.disabled = newState;
                saveConfig(configs.value);
                showToast(`✅ 已${action}「${card.label}」`);
            }
        }

        // 回收站列表：已软删除的银行卡
        const deletedCards = computed(() => configs.value.filter(c => c.isDeleted));

        function openRecycleBin() {
            recycleBinVisible.value = true;
        }

        function closeRecycleBin() {
            recycleBinVisible.value = false;
        }

        // 恢复银行卡：软删除标记还原，历史记录中的对应数据自动恢复显示
        function restoreCard(card) {
            const restored = restoreBankCard(configs.value, card.key);
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
        function confirmPermanentDelete() {
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

            const result = permanentDeleteBankCard(configs.value, records.value, card.key);
            if (!result) {
                showToast('❌ 银行卡不存在');
                return;
            }
            showToast(`✅ 已彻底删除「${result.label}」，其历史数据共 ${result.removedCount} 条已清除`);
        }

        // 关闭银行卡表单弹窗，有未保存修改时先确认
        function closeBankCardForm() {
            if (bankFormModified.value) {
                if (!confirm('您有未保存的修改，确定要关闭吗？')) {
                    return;
                }
            }
            bankFormVisible.value = false;
        }

        // 清空所有数据，谨慎操作！二次确认防误触
        function clearData() {
            if (confirm('确认清空所有数据？此操作不可恢复！')) {
                localStorage.removeItem(STORAGE_KEYS.RECORDS);
                localStorage.removeItem(STORAGE_KEYS.BANK_CARD_CONFIGS);
                localStorage.removeItem(STORAGE_KEYS.TARGET);
                location.reload();
            }
        }

        // 目标计划
        /**
         * 打开目标计划弹窗
         * 从 localStorage 加载目标数据，最新一条记录的总余额作为当前余额
         */
        function openTargetModal() {
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.TARGET);
                if (raw) {
                    const data = JSON.parse(raw);
                    targetForm.value = {...targetForm.value, ...data};
                }
            } catch (_) {
            }
            // 检测旧版目标数据（有目标金额但缺每年支出，提示用户补充）
            legacyTargetDetected.value = targetForm.value.targetAmount > 0 && !targetForm.value.annualExpense;
            // 最新一条记录（日期最新）的总余额作为当前余额
            const sorted = sortedRecords.value;
            const latest = sorted.length ? sorted[0] : null;
            targetForm.value.currentBalance = latest ? getBalance(latest) : 0;
            targetCalculated.value = false;
            targetEditable.value = false;
            targetModalVisible.value = true;
        }

        function closeTargetModal() {
            if (targetEditable.value) {
                if (!confirm('您有未保存的修改，确定要关闭吗？')) return;
            }
            targetModalVisible.value = false;
            legacyTargetDetected.value = false;
        }

        /**
         * 计算"距离目标剩余"和"预计达成日期"
         */
        function calcTarget() {
            const annual = Number(targetForm.value.annualIncome) || 0;
            const target = calcTargetAmount(targetForm.value.annualExpense, targetForm.value.targetDate); // 实时计算
            const current = Number(targetForm.value.currentBalance) || 0;
            if (target <= 0 || annual <= 0) {
                showToast('请先填写有效的每年收入和目标金额');
                return;
            }

            targetForm.value.targetAmount = target; // 仅用于计算结果快照展示，不存到存储
            // 复用公共计算函数（与 CSV 导出逻辑一致）
            const result = calcTargetStats(annual, target, current);
            targetForm.value.remaining = result.remaining;
            targetForm.value.targetDateDisplay = result.targetDateDisplay;
            targetForm.value.targetDuration = result.targetDuration;
            targetCalculated.value = true;
        }

        /**
         * 保存目标计划数据
         */
        function saveTarget() {
            try {
                // 使用公共函数构建完整数据（自动计算目标金额）
                const data = buildTargetData(targetForm.value);
                localStorage.setItem(STORAGE_KEYS.TARGET, JSON.stringify(data));

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
        function cancelTargetEdit() {
            if (targetEditable.value) {
                if (!confirm('您有未保存的修改，确定要返回吗？')) return;
            }
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.TARGET);
                if (raw) {
                    const data = JSON.parse(raw);
                    targetForm.value = {...targetForm.value, ...data};
                }
            } catch (_) {
            }
            targetEditable.value = false;
            targetCalculated.value = false;
            showToast('已返回详情');
        }

        /**
         * 备注展开/收起
         */
        function toggleRemark() {
            showRemark.value = !showRemark.value;
        }

        onMounted(() => {
            loadData();
            // 监听银行卡表单内容变化，标记未保存状态
            watch(bankForm, () => {
                if (bankFormVisible.value) {
                    bankFormModified.value = true;
                }
            }, {deep: true});
            // 编辑态刷新/关闭页面时拦截，防止未保存输入丢失
            // 纯浏览态（查看记录、银行卡列表）不拦截，刷新不会丢数据
            window.addEventListener('beforeunload', function (e) {
                const recordEditing = modalVisible.value
                    && (modalMode.value === 'add' || (modalMode.value === 'edit' && editable.value));
                const editing = recordEditing || bankFormVisible.value;
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
            form,
            showRemark,
            displayFields,
            allConfigs,
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
            getDeletedDepositTotal,
            getDeletedDebtTotal,
            hasDeletedFields,
            getDiff,
            formatNumber,
            formatDateToDot,
            shouldShowFieldInModal,
            shouldShowTypeField,

            openAddModal,
            openEditModal,
            cancelEdit,
            saveRecord,
            deleteRecord,
            copyRecord,
            filterNumber,
            refreshData,

            openBankCardManager,
            openAddBankCard,
            openEditBankCard,
            saveBankCard,
            toggleBankCardDisabled,
            deleteBankCard,
            deletedCards,
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

            // 导出和导入
            exportCSV,
            exportJSON,
            triggerImport,
            importJSON,
            importModalVisible,
            importStats,
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
            legacyTargetDetected,
            legacySuggestedExpense,
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
