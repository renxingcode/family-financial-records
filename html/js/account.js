const {createApp, ref, computed, onMounted} = Vue;

// 配置 & 存储
var STORAGE_KEYS = {
    RECORDS: 'financial_account_records',
    BANK_CARD_CONFIGS: 'financial_account_bank_card_configs'
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

        // 银行卡管理
        const bankManagerVisible = ref(false);
        const bankFormVisible = ref(false);
        const bankFormMode = ref('add');  // 'add' | 'edit'
        const bankForm = ref({key: '', label: '', category: ['deposit', 'debt']});
        const editingCardKey = ref('');

        // 计算
        const displayFields = computed(() => configs.value);
        const allConfigs = computed(() => configs.value);
        const editableFields = computed(() => configs.value);

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
            return Number(item[f.key + '_' + type]) || 0;
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
         * 格式化数字，添加千位分隔符
         * 例如：3200 → "3,200"
         */
        function formatNumber(num) {
            if (num === undefined || num === null || isNaN(num)) return num;
            return Number(num).toLocaleString('en-US');
        }

        function prevPage() {
            if (currentPage.value > 1) currentPage.value--;
        }

        function nextPage() {
            if (currentPage.value < totalPages.value) currentPage.value++;
        }

        function exportJSON() {
            if (records.value.length === 0 && configs.value.length === 0) {
                showToast('暂无数据');
                return;
            }
            const data = {
                config: configs.value,
                records: records.value,
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'account.json';
            a.click();
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
            modalVisible.value = true;
        }

        function openEditModal(idx) {
            const item = sortedRecords.value[idx];
            if (!item) return;
            const realIdx = records.value.findIndex(r => r.date === item.date);
            if (realIdx === -1) return;
            modalMode.value = 'edit';
            editable.value = false; // 默认查看态
            editIndex.value = realIdx;
            form.value = {...records.value[realIdx]};
            modalVisible.value = true;
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

        function deleteRecord() {
            if (confirm('确定删除该记录？')) {
                records.value.splice(editIndex.value, 1);
                saveData();
                modalVisible.value = false;
                showToast('🗑 已删除');
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
            bankFormVisible.value = true;
        }

        function openEditBankCard(card) {
            bankFormMode.value = 'edit';
            bankForm.value = {...card};
            editingCardKey.value = card.key;
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
            bankFormVisible.value = false;
        }

        onMounted(() => {
            loadData();
        });

        return {
            records,
            sortedRecords,
            modalVisible,
            modalMode,
            editable,
            form,
            displayFields,
            allConfigs,
            editableFields,
            bankManagerVisible,
            bankFormVisible,
            bankFormMode,
            bankForm,
            toastMsg,

            getFieldValue,
            getTotalDeposit,
            getTotalDebt,
            getBalance,
            formatNumber,

            openAddModal,
            openEditModal,
            saveRecord,
            deleteRecord,
            filterNumber,

            openBankManager,
            openAddBankCard,
            openEditBankCard,
            saveBankCard,

            // 分页
            currentPage,
            totalPages,
            paginatedRecords,
            prevPage,
            nextPage,

            exportJSON,
            triggerImport,
            importJSON,
        };
    }
});

app.mount('#app');
