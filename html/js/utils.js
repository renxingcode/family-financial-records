/**
 * utils.js
 * 通用工具函数层：数字/日期格式化、目标金额与剩余月数计算等纯函数
 * 不依赖任何业务存储，所有方法通过 window.FinancialUtils 全局挂载
 */
(function () {
    'use strict';

    /**
     * 格式化数字，添加千位分隔符
     * 例如：3200 → "3,200"
     */
    function formatNumber(num) {
        if (num === undefined || num === null || isNaN(num)) return num;
        return Number(num).toLocaleString('en-US');
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
     * 注意：目标金额由每年支出和目标日期实时计算，不写入存储，故此处不含 targetAmount
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

    /**
     * 生成银行卡唯一标识
     * @returns {string} 以 card_ 开头的唯一 key
     */
    function generateKey() {
        return 'card_' + Date.now();
    }

    window.FinancialUtils = {
        formatNumber,
        formatDuration,
        formatDateToDot,
        calcMonths,
        calcTargetAmount,
        buildTargetData,
        calcTargetStats,
        generateKey
    };
})();
