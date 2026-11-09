/**
 * account 数据访问层（Data Access Layer）
 *
 * 唯一的数据读写入口，所有方法均为 async 接口（返回 Promise）。
 * 底层使用 localStorage.js 完成本地持久化。
 * account 模块的存储 Key 常量也在本文件集中管理。
 * 未来接入后端服务时，仅需修改本文件内部实现（将 Storage 调用替换为服务端接口），
 * 上层 modules / pages 调用方无需改动。
 *
 * 依赖：localStorage.js
 * 挂在 window.AccountData 上
 */
(function (global) {
    'use strict';

    var Storage = global.FinancialLocalStorage;

    /**
     * account 模块的存储 Key 常量（数据访问层统一管理）
     * 从 V0.1 定死不变，避免历史数据不兼容
     */
    var KEYS = {
        RECORDS: 'financial_account_records',
        BANK_CARD_CONFIGS: 'financial_account_bank_card_configs',
        TARGET: 'financial_account_target',
        UI_PREFS: 'financial_account_ui_prefs'
    };

    /**
     * 读取账户记录
     * @returns {Promise<Array>} 记录数组，无数据时返回空数组
     */
    async function loadRecords() {
        var data = Storage.load(KEYS.RECORDS);
        return Array.isArray(data) ? data : [];
    }

    /**
     * 保存账户记录
     * @param {Array} records - 记录数组
     * @returns {Promise<void>}
     */
    async function saveRecords(records) {
        Storage.save(KEYS.RECORDS, records);
    }

    /**
     * 读取银行卡配置
     * @returns {Promise<Array>} 配置数组，无数据时返回空数组
     */
    async function loadBankCardConfigs() {
        var data = Storage.load(KEYS.BANK_CARD_CONFIGS);
        return Array.isArray(data) ? data : [];
    }

    /**
     * 保存银行卡配置
     * @param {Array} configs - 配置数组
     * @returns {Promise<void>}
     */
    async function saveBankCardConfigs(configs) {
        Storage.save(KEYS.BANK_CARD_CONFIGS, configs);
    }

    /**
     * 读取目标计划
     * @returns {Promise<Object|null>} 目标对象，无数据时返回 null
     */
    async function loadTarget() {
        return Storage.load(KEYS.TARGET);
    }

    /**
     * 保存目标计划
     * @param {Object} target - 目标对象
     * @returns {Promise<void>}
     */
    async function saveTarget(target) {
        Storage.save(KEYS.TARGET, target);
    }

    /**
     * 删除目标计划
     * @returns {Promise<void>}
     */
    async function removeTarget() {
        Storage.remove(KEYS.TARGET);
    }

    /**
     * 读取 UI 偏好
     * @returns {Promise<Object>} 偏好对象，无数据时返回空对象
     */
    async function loadUIPrefs() {
        var data = Storage.load(KEYS.UI_PREFS);
        return (data && typeof data === 'object') ? data : {};
    }

    /**
     * 保存 UI 偏好
     * @param {Object} prefs - 偏好对象
     * @returns {Promise<void>}
     */
    async function saveUIPrefs(prefs) {
        Storage.save(KEYS.UI_PREFS, prefs);
    }

    /**
     * 清空所有 account 模块数据（不可恢复）
     * @returns {Promise<void>}
     */
    async function clearAll() {
        Storage.remove(KEYS.RECORDS);
        Storage.remove(KEYS.BANK_CARD_CONFIGS);
        Storage.remove(KEYS.TARGET);
        Storage.remove(KEYS.UI_PREFS);
    }

    // 暴露到全局
    global.AccountData = {
        KEYS: KEYS,
        loadRecords: loadRecords,
        saveRecords: saveRecords,
        loadBankCardConfigs: loadBankCardConfigs,
        saveBankCardConfigs: saveBankCardConfigs,
        loadTarget: loadTarget,
        saveTarget: saveTarget,
        removeTarget: removeTarget,
        loadUIPrefs: loadUIPrefs,
        saveUIPrefs: saveUIPrefs,
        clearAll: clearAll
    };

})(window);
