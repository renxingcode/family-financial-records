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
 * TARGET: 目标计划（Object<{ annualIncome, incomeRemark, targetAmount, targetDate, targetRemark, ... }>）
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
        const remarkExpanded = ref(false); // 只读态备注是否展开（查看更多）

        // 银行卡管理
        const bankManagerVisible = ref(false);
        const bankFormVisible = ref(false);
        const bankFormMode = ref('add');  // 'add' | 'edit'
        const bankForm = ref({key: '', label: '', category: ['deposit', 'debt']});
        const editingCardKey = ref('');
        const bankFormModified = ref(false); // 标记银行卡表单是否被修改过

        // 目标
        const targetModalVisible = ref(false);
        const targetEditable = ref(false);
        const targetForm = ref({
            annualIncome: '',
            incomeRemark: '',
            targetAmount: '',
            targetDate: '',
            targetRemark: '',
            currentBalance: 0,
            remaining: 0,
            targetDateDisplay: '',
            targetDuration: ''
        });
        const targetCalculated = ref(false);

        // 计算
        // displayFields: 列表中实际显示的银行卡列（按类型拆成存款/负债独立列）
        const displayFields = computed(() => {
            return configs.value;
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
        function getFieldValue(item, f, type) {
            const fieldName = f.key + '_' + type;
            if (item[fieldName] === undefined || item[fieldName] === null) return null;
            return Number(item[fieldName]) || 0;
        }

        function getTotalDeposit(item) {
            let sum = 0;
            configs.value.forEach(f => {
                if (f.category.includes('deposit')) {
                    sum += Number(item[f.key + '_deposit']) || 0;
                }
            });
            return sum;
        }

        function getTotalDebt(item) {
            let sum = 0;
            configs.value.forEach(f => {
                if (f.category.includes('debt')) {
                    sum += Number(item[f.key + '_debt']) || 0;
                }
            });
            return sum;
        }

        function getBalance(item) {
            return getTotalDeposit(item) - getTotalDebt(item);
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
         * 添加/编辑态：始终显示（编辑态需要所有卡都可输入）
         * 查看态：只显示该记录中有非零金额的卡，避免大量 0 值占位
         * @param {Object} f - 银行卡配置项
         * @returns {boolean}
         */
        function shouldShowFieldInModal(f) {
            if (modalMode.value === 'add' || editable.value) {
                return true;
            }
            // 查看态：检查该记录中该卡是否有非零金额
            return f.category.some(type => {
                const val = Number(form.value[f.key + '_' + type]) || 0;
                return val !== 0;
            });
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

            // 1. 构建表头
            const headers = ['日期', '总余额', '总存款', '总负债'];
            configs.value.forEach(f => {
                if (f.category.includes('deposit')) headers.push(`${f.label}存款`);
                if (f.category.includes('debt')) headers.push(`${f.label}负债`);
            });
            headers.push('备注');

            // 2. 构建数据行
            const rows = sorted.map(item => {
                const row = [
                    item.date,
                    getBalance(item),
                    getTotalDeposit(item),
                    getTotalDebt(item),
                ];
                configs.value.forEach(f => {
                    if (f.category.includes('deposit')) row.push(Number(item[f.key + '_deposit']) || 0);
                    if (f.category.includes('debt')) row.push(Number(item[f.key + '_debt']) || 0);
                });
                row.push(item.remark || '');
                return row;
            });

            // 3. 拼接 CSV（含逗号或引号的字段加引号转义）
            const lines = [headers.join(',')];
            rows.forEach(row => {
                const escaped = row.map(val => {
                    if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                        return '"' + val.replace(/"/g, '""') + '"';
                    }
                    return val;
                });
                lines.push(escaped.join(','));
            });

            // 4. 下载
            const csv = lines.join('\n');
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

            // 按日期降序排列
            const sortedForExport = [...records.value].sort((a, b) => b.date.localeCompare(a.date));

            const data = {
                version: VERSION_NUMBER,
                exportTime: new Date().toISOString(),
                config: configs.value,
                records: sortedForExport,
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
                    // 覆盖配置
                    if (data.config && Array.isArray(data.config)) {
                        configs.value = data.config;
                        saveConfig(configs.value);
                    }
                    // 覆盖记录
                    records.value = data.records;
                    saveData();
                    currentPage.value = 1;
                    showToast('✅ 导入成功');
                } catch (err) {
                    showToast('❌ 文件解析失败');
                }
            };
            reader.readAsText(file);
            event.target.value = '';
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
            remarkExpanded.value = false;
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
            remarkExpanded.value = false;
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
                if (k !== 'date' && k !== 'remark') {
                    clean[k] = Number(f[k]) || 0;
                }
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
                remarkExpanded.value = false;
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
        function openBankManager() {
            bankManagerVisible.value = true;
        }

        function openAddBankCard() {
            bankFormMode.value = 'add';
            bankForm.value = {key: '', label: '', category: ['deposit', 'debt']};
            editingCardKey.value = '';
            bankFormModified.value = false;
            bankFormVisible.value = true;
        }

        function openEditBankCard(card) {
            bankFormMode.value = 'edit';
            bankForm.value = {...card};
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

            if (bankFormMode.value === 'add') {
                configs.value.push({
                    key: generateKey(),
                    label: label,
                    category: [...bankForm.value.category],
                    disabled: false,
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
                showToast('✅ 银行卡已更新');
            }
            saveConfig(configs.value);
            bankFormModified.value = false;
            bankFormVisible.value = false;
        }

        function toggleBankCardDisabled(key) {
            const card = configs.value.find(f => f.key === key);
            if (!card) return;
            const newState = !card.disabled;
            const action = newState ? '禁用' : '启用';
            if (confirm(`确定要${action}「${card.label}」吗？`)) {
                card.disabled = newState;
                saveConfig(configs.value);
                showToast(`✅ 已${action}「${card.label}」`);
            }
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
        }

        /**
         * 计算"距离目标剩余"和"预计达成日期"
         */
        function calcTarget() {
            const annual = Number(targetForm.value.annualIncome) || 0;
            const target = Number(targetForm.value.targetAmount) || 0;
            const current = Number(targetForm.value.currentBalance) || 0;
            if (target <= 0 || annual <= 0) {
                showToast('请先填写有效的年收入和目标金额');
                return;
            }

            const remaining = target - current;
            targetForm.value.remaining = remaining;

            // 计算距离目标日期的时间
            const targetDate = targetForm.value.targetDate;
            if (targetDate) {
                const now = new Date();
                const targetDt = new Date(targetDate);
                const diffMs = targetDt - now;
                if (diffMs > 0) {
                    const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44);
                    const years = Math.floor(diffMonths / 12);
                    const months = Math.round(diffMonths % 12);
                    let duration = '';
                    if (years > 0) duration += years + '年';
                    if (months > 0) duration += months + '个月';
                    if (!duration) duration = '不足1个月';
                    targetForm.value.targetDuration = duration;
                    const y = targetDt.getFullYear();
                    const m = String(targetDt.getMonth() + 1).padStart(2, '0');
                    targetForm.value.targetDateDisplay = `${y}年${m}月`;
                } else {
                    targetForm.value.targetDuration = '已过期';
                    targetForm.value.targetDateDisplay = '已过期';
                }
            } else {
                targetForm.value.targetDuration = '请设定目标日期';
                targetForm.value.targetDateDisplay = '';
            }
            targetCalculated.value = true;
        }

        /**
         * 保存目标计划数据
         */
        function saveTarget() {
            try {
                const data = {
                    annualIncome: targetForm.value.annualIncome,
                    incomeRemark: targetForm.value.incomeRemark,
                    targetAmount: targetForm.value.targetAmount,
                    targetDate: targetForm.value.targetDate,
                    targetRemark: targetForm.value.targetRemark
                };
                localStorage.setItem(STORAGE_KEYS.TARGET, JSON.stringify(data));
                showToast('✅ 目标已保存');
                targetEditable.value = false;
            } catch (_) {
                showToast('❌ 保存失败');
            }
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
            remarkExpanded,
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
            getDiff,
            formatNumber,
            shouldShowFieldInModal,

            openAddModal,
            openEditModal,
            cancelEdit,
            saveRecord,
            deleteRecord,
            copyRecord,
            filterNumber,
            refreshData,

            openBankManager,
            openAddBankCard,
            openEditBankCard,
            saveBankCard,
            toggleBankCardDisabled,

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

            // 全屏
            toggleFullscreen,

            // 目标
            targetModalVisible,
            targetEditable,
            targetForm,
            targetCalculated,
            openTargetModal,
            closeTargetModal,
            calcTarget,
            saveTarget,
        };
    }
});

app.mount('#app');
