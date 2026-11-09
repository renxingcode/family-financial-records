/**
 * localStorage 操作封装
 * 提供统一的读写接口，所有数据持久化都通过这里
 * 挂在 window.FinancialLocalStorage 上
 */
(function (global) {
    'use strict';

    /**
     * 从 localStorage 读取数据
     * @param {string} key - 存储键名
     * @returns {any} 解析后的数据，若不存在或解析失败则返回 null
     */
    function load(key) {
        try {
            var raw = localStorage.getItem(key);
            if (raw) {
                return JSON.parse(raw);
            }
        } catch (_) {
        }
        return null;
    }

    /**
     * 保存数据到 localStorage
     * @param {string} key - 存储键名
     * @param {any} data - 要保存的数据（会被 JSON.stringify）
     */
    function save(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    }

    /**
     * 从 localStorage 删除数据
     * @param {string} key - 存储键名
     */
    function remove(key) {
        localStorage.removeItem(key);
    }

    // 暴露到全局
    global.FinancialLocalStorage = {
        load: load,
        save: save,
        remove: remove
    };

})(window);
