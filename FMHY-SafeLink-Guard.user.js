// ==UserScript==
// @name         FMHY SafeLink Guard Edited
// @namespace    http://tampermonkey.net/
// @version      0.6.1
// @description  Warns about unsafe/scammy links based on FMHY filterlist
// @author       maxikozie
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      raw.githubusercontent.com
// @run-at       document-end
// @license      MIT
// @icon         https://fmhy.net/fmhy.ico
// @downloadURL https://update.greasyfork.org/scripts/528660/FMHY%20SafeLink%20Guard.user.js
// @updateURL https://update.greasyfork.org/scripts/528660/FMHY%20SafeLink%20Guard.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const excludedDomains = [
        'fmhy.net',
        'fmhy.pages.dev',
        'fmhy.lol',
        'fmhy.vercel.app',
        'fmhy.xyz'
    ];

    const currentDomain = window.location.hostname.toLowerCase();

    if (excludedDomains.some(domain => currentDomain.endsWith(domain))) {
        console.log(`[FMHY Guard] Script disabled on ${currentDomain}`);
        return;
    }

    const unsafeListUrl = 'https://raw.githubusercontent.com/fmhy/FMHYFilterlist/main/sitelist.txt';
    const safeListUrl   = 'https://raw.githubusercontent.com/fmhy/bookmarks/main/fmhy_in_bookmarks.html';

    const unsafeDomains = new Set();
    const safeDomains   = new Set();

    const CACHE_TIME = 7 * 24 * 60 * 60 * 1000;
    const CACHE_KEYS = {
        UNSAFE: 'fmhy-unsafeCache',
        SAFE:   'fmhy-safeCache'
    };

    const userTrusted   = new Set(GM_getValue('trusted', []));
    const userUntrusted = new Set(GM_getValue('untrusted', []));

    const settings = {
        highlightTrusted:   GM_getValue('highlightTrusted', true),
        highlightUntrusted: GM_getValue('highlightUntrusted', true),
        showWarningBanners: GM_getValue('showWarningBanners', true),
        trustedColor:       GM_getValue('trustedColor', '#32cd32'),
        untrustedColor:     GM_getValue('untrustedColor', '#ff4444')
    };

    const processedLinks          = new WeakSet();
    const highlightCountTrusted   = new Map();
    const highlightCountUntrusted = new Map();
    const banneredDomains         = new Set();

    const warningStyle = `
        background-color: #ff0000;
        color: #fff;
        padding: 2px 6px;
        font-weight: bold;
        border-radius: 4px;
        font-size: 12px;
        margin-left: 6px;
        z-index: 9999;
    `;

    GM_registerMenuCommand('⚙️ FMHY SafeLink Guard Settings', openSettingsPanel);

    GM_registerMenuCommand('🔄 Force Update FMHY Lists', () => {
        GM_deleteValue(CACHE_KEYS.UNSAFE);
        GM_deleteValue(CACHE_KEYS.SAFE);
        alert('FMHY lists cache cleared. The script will fetch fresh data now or on next page load.');
        fetchRemoteLists();
    });

    GM_registerMenuCommand('📂 Download All Caches', downloadAllCaches);

    function downloadAllCaches() {
        const unsafeData = GM_getValue(CACHE_KEYS.UNSAFE, null);
        const safeData   = GM_getValue(CACHE_KEYS.SAFE, null);

        if (!unsafeData && !safeData) {
            alert('No cache data found for either safe or unsafe.');
            return;
        }

        const combinedData = { unsafeCache: unsafeData, safeCache: safeData };
        const blob = new Blob([JSON.stringify(combinedData, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'fmhy-all-caches.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    fetchRemoteLists();

    function fetchRemoteLists() {
        const now = Date.now();
        const cachedUnsafe = GM_getValue(CACHE_KEYS.UNSAFE, null);

        if (cachedUnsafe && cachedUnsafe.timestamp && (now - cachedUnsafe.timestamp < CACHE_TIME)) {
            parseDomainList(cachedUnsafe.data, unsafeDomains);
            console.log(`[FMHY Guard] Loaded ${unsafeDomains.size} unsafe domains from cache`);
            loadSafeList(now);
        } else {
            fetchUnsafeList(now);
        }
    }

    function fetchUnsafeList(now) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: unsafeListUrl,
            onload: response => {
                if (response.status !== 200 || !response.responseText) {
                    console.error('[FMHY Guard] Invalid response from server. Using stale cache.');
                    loadSafeList(now);
                    return;
                }
                const data = response.responseText;
                parseDomainList(data, unsafeDomains);
                GM_setValue(CACHE_KEYS.UNSAFE, { timestamp: now, data: data });
                console.log('[FMHY Guard] Updated unsafe domains cache');
                loadSafeList(now);
            },
            onerror: () => {
                console.error('[FMHY Guard] Fetch failed, using stale cache.');
                const cached = GM_getValue(CACHE_KEYS.UNSAFE, null);
                if (cached) parseDomainList(cached.data, unsafeDomains);
                loadSafeList(now);
            }
        });
    }

    function loadSafeList(now) {
        const cachedSafe = GM_getValue(CACHE_KEYS.SAFE, null);
        if (cachedSafe && cachedSafe.timestamp && (now - cachedSafe.timestamp < CACHE_TIME)) {
            parseSafeList(cachedSafe.data);
            console.log(`[FMHY Guard] Loaded ${safeDomains.size} safe domains from cache`);
            finishLoading();
        } else {
            fetchSafeList(now);
        }
    }

    function fetchSafeList(now) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: safeListUrl,
            onload: response => {
                const data = response.responseText;
                parseSafeList(data);
                GM_setValue(CACHE_KEYS.SAFE, { timestamp: now, data: data });
                console.log('[FMHY Guard] Updated safe domains cache');
                finishLoading();
            },
            onerror: () => {
                console.error('[FMHY Guard] Using stale safe cache (fetch failed)');
                const cached = GM_getValue(CACHE_KEYS.SAFE, null);
                if (cached) parseSafeList(cached.data);
                finishLoading();
            }
        });
    }

    function finishLoading() {
        applyUserOverrides();
        processPage();
    }

    function parseDomainList(text, targetSet) {
        let start = 0;
        const len = text.length;
        while (start < len) {
            let end = text.indexOf('\n', start);
            if (end === -1) end = len;
            const line = text.slice(start, end).trim().toLowerCase();
            if (line && line[0] !== '!') targetSet.add(line);
            start = end + 1;
        }
    }

    function parseSafeList(data) {
        const hrefRegex = /href=["']([^"']+)["']/gi;
        let match;
        while ((match = hrefRegex.exec(data)) !== null) {
            const raw = match[1];
            const start = raw.indexOf('//');
            if (start === -1) continue;
            const afterSlashes = start + 2;
            let end = raw.indexOf('/', afterSlashes);
            if (end === -1) end = raw.length;
            let hostname = raw.slice(afterSlashes, end).toLowerCase();
            const atSign = hostname.indexOf('@');
            if (atSign !== -1) hostname = hostname.slice(atSign + 1);
            const colon = hostname.indexOf(':');
            if (colon !== -1) hostname = hostname.slice(0, colon);
            if (hostname) safeDomains.add(normalizeDomain(hostname));
        }
    }

    function applyUserOverrides() {
        userTrusted.forEach(domain => {
            safeDomains.add(domain);
            unsafeDomains.delete(domain);
        });
        userUntrusted.forEach(domain => {
            unsafeDomains.add(domain);
            safeDomains.delete(domain);
        });
    }

    function processPage() {
        markLinks(document.body);
        observePage();

        // FIX: window.load re-scan is now scoped to only the anchors that are
        // not yet in processedLinks (i.e. freshly re-rendered elements), instead
        // of a full markLinks(document.body) which rescanned the entire page.
        // banneredDomains.delete(currentDomain) allows the re-rendered header
        // anchor to get a fresh banner without affecting any other domain.
        window.addEventListener('load', () => {
            banneredDomains.delete(currentDomain);
            const anchors = document.querySelectorAll('a[href]');
            for (let i = 0; i < anchors.length; i++) {
                if (!processedLinks.has(anchors[i])) {
                    processLink(anchors[i]);
                }
            }
        }, { once: true });
    }

    // FIX: extracted single-link processing logic out of the loop in markLinks
    // so the window.load handler can call it per-anchor without a full container
    // scan — avoids the double full-page querySelectorAll on load
    function processLink(link) {
        processedLinks.add(link);

        const protocol = link.protocol;
        if (protocol !== 'https:' && protocol !== 'http:') return;

        const raw = link.hostname;
        const domain = normalizeDomain(raw || currentDomain);
        if (!domain) return;

        if (
            (safeDomains.has(currentDomain) || userTrusted.has(currentDomain)) &&
            domain === currentDomain
        ) {
            return;
        }

        if (userUntrusted.has(domain) || (!userTrusted.has(domain) && unsafeDomains.has(domain))) {
            if (settings.highlightUntrusted && getHighlightCount(highlightCountUntrusted, domain) < 2) {
                highlightLink(link, 'untrusted');
                incrementHighlightCount(highlightCountUntrusted, domain);
            }
            if (settings.showWarningBanners && !banneredDomains.has(domain)) {
                if (banneredDomains.size > 1000) banneredDomains.clear();
                banneredDomains.add(domain);
                addWarningBanner(link);
            }
        } else if (userTrusted.has(domain) || safeDomains.has(domain)) {
            if (settings.highlightTrusted && getHighlightCount(highlightCountTrusted, domain) < 2) {
                highlightLink(link, 'trusted');
                incrementHighlightCount(highlightCountTrusted, domain);
            }
        }
    }

    function markLinks(container) {
        if (container.tagName === 'A') {
            if (!processedLinks.has(container)) processLink(container);
            return;
        }
        const links = container.querySelectorAll('a[href]');
        for (let i = 0; i < links.length; i++) {
            if (!processedLinks.has(links[i])) processLink(links[i]);
        }
    }

    // FIX: deduplicate parent/child redundancy before processing —
    // if a parent node is in pendingNodes, any of its children that are
    // also in pendingNodes are redundant (the parent scan covers them).
    // This prevents the same links being scanned multiple times when a site
    // inserts a container and all its children as separate mutation records.
    function observePage() {
        let pendingNodes = new Set();
        let scheduled = false;

        function processPending() {
            // Build a filtered list: skip any node whose ancestor is already queued
            const toProcess = [];
            pendingNodes.forEach(node => {
                let ancestor = node.parentNode;
                let dominated = false;
                while (ancestor) {
                    if (pendingNodes.has(ancestor)) { dominated = true; break; }
                    ancestor = ancestor.parentNode;
                }
                if (!dominated) toProcess.push(node);
            });
            pendingNodes.clear();
            scheduled = false;
            for (let i = 0; i < toProcess.length; i++) markLinks(toProcess[i]);
        }

        const observer = new MutationObserver(mutations => {
            for (let i = 0; i < mutations.length; i++) {
                const added = mutations[i].addedNodes;
                for (let j = 0; j < added.length; j++) {
                    const node = added[j];
                    // FIX: only queue element nodes that are or contain anchors —
                    // skips <br>, <span>, <div> with no links, text nodes, etc.
                    // tagName check is a free property read; querySelector is only
                    // called when tagName is not already 'A'
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    if (node.tagName === 'A' || node.querySelector('a[href]')) {
                        pendingNodes.add(node);
                    }
                }
            }
            if (!scheduled && pendingNodes.size > 0) {
                scheduled = true;
                if (typeof requestIdleCallback === 'function') {
                    requestIdleCallback(processPending, { timeout: 500 });
                } else {
                    setTimeout(processPending, 50);
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    function highlightLink(link, type) {
        const color = (type === 'trusted') ? settings.trustedColor : settings.untrustedColor;
        link.style.textShadow = `0 0 4px ${color}`;
        link.style.fontWeight = 'bold';
    }

    function addWarningBanner(link) {
        const warning = document.createElement('span');
        warning.textContent = '⚠️ FMHY Unsafe Site';
        warning.style = warningStyle;
        link.after(warning);
    }

    function normalizeDomain(hostname) {
        if (!hostname) return '';
        return hostname.startsWith('www.') ? hostname.slice(4).toLowerCase() : hostname.toLowerCase();
    }

    function getHighlightCount(map, domain) {
        return map.get(domain) || 0;
    }

    function incrementHighlightCount(map, domain) {
        if (map.size > 1000) map.clear();
        map.set(domain, (map.get(domain) || 0) + 1);
    }

    function saveSettings() {
        settings.highlightTrusted   = document.getElementById('highlightTrusted').checked;
        settings.highlightUntrusted = document.getElementById('highlightUntrusted').checked;
        settings.showWarningBanners = document.getElementById('showWarningBanners').checked;
        settings.trustedColor       = document.getElementById('trustedColor').value;
        settings.untrustedColor     = document.getElementById('untrustedColor').value;

        GM_setValue('highlightTrusted',   settings.highlightTrusted);
        GM_setValue('highlightUntrusted', settings.highlightUntrusted);
        GM_setValue('showWarningBanners', settings.showWarningBanners);
        GM_setValue('trustedColor',       settings.trustedColor);
        GM_setValue('untrustedColor',     settings.untrustedColor);

        saveDomainList('trustedList', userTrusted);
        saveDomainList('untrustedList', userUntrusted);
    }

    function saveDomainList(id, set) {
        set.clear();
        document.getElementById(id).value
            .split('\n')
            .map(d => d.trim().toLowerCase())
            .filter(Boolean)
            .forEach(dom => set.add(dom));

        GM_setValue(id === 'trustedList' ? 'trusted' : 'untrusted', [...set]);
    }

    function openSettingsPanel() {
        document.getElementById('fmhy-settings-panel')?.remove();

        const panel = document.createElement('div');
        panel.id = 'fmhy-settings-panel';
        panel.style = `
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            background: #222;
            color: #fff;
            padding: 20px;
            border-radius: 10px;
            font-family: sans-serif;
            font-size: 14px;
            z-index: 99999;
            width: 450px;
            max-height: 90vh;
            overflow-y: auto;
            overflow-x: hidden;
            box-shadow: 0 0 15px rgba(0,0,0,0.5);
        `;

        panel.innerHTML = `
            <h3 style="text-align:center; margin:0 0 15px;">⚙️ FMHY SafeLink Guard Settings</h3>

            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                <input type="checkbox" id="highlightTrusted" style="margin-right: 6px;">
                <label for="highlightTrusted" style="flex-grow: 1; cursor: pointer;">🟢 Highlight Trusted Links</label>
                <input type="color" id="trustedColor" style="width: 30px; height: 20px; border: none; cursor: pointer;">
            </div>

            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                <input type="checkbox" id="highlightUntrusted" style="margin-right: 6px;">
                <label for="highlightUntrusted" style="flex-grow: 1; cursor: pointer;">🔴 Highlight Untrusted Links</label>
                <input type="color" id="untrustedColor" style="width: 30px; height: 20px; border: none; cursor: pointer;">
            </div>

            <div style="display: flex; align-items: center; margin-bottom: 12px;">
                <input type="checkbox" id="showWarningBanners" style="margin-right: 6px;">
                <label for="showWarningBanners" style="flex-grow: 1; cursor: pointer;">⚠️ Show Warning Banners</label>
            </div>

            <label style="display: block; margin-bottom: 5px;">Trusted Domains (1 per line):</label>
            <textarea id="trustedList" style="width: 100%; height: 80px; margin-bottom: 10px; background: #333; color: #fff; border: 1px solid #555;"></textarea>

            <label style="display: block; margin-bottom: 5px;">Untrusted Domains (1 per line):</label>
            <textarea id="untrustedList" style="width: 100%; height: 80px; margin-bottom: 10px; background: #333; color: #fff; border: 1px solid #555;"></textarea>

            <div style="text-align: left;">
                <button id="saveSettingsBtn" style="background:#28a745;color:white;padding:6px 12px;border:none;border-radius:4px;cursor:pointer;">Save</button>
                <button id="closeSettingsBtn" style="background:#dc3545;color:white;padding:6px 12px;border:none;border-radius:4px;cursor:pointer;margin-left:10px;">Close</button>
            </div>
        `;

        document.body.appendChild(panel);

        document.getElementById('highlightTrusted').checked   = settings.highlightTrusted;
        document.getElementById('highlightUntrusted').checked = settings.highlightUntrusted;
        document.getElementById('showWarningBanners').checked = settings.showWarningBanners;
        document.getElementById('trustedColor').value         = settings.trustedColor;
        document.getElementById('untrustedColor').value       = settings.untrustedColor;
        document.getElementById('trustedList').value          = [...userTrusted].join('\n');
        document.getElementById('untrustedList').value        = [...userUntrusted].join('\n');

        document.getElementById('saveSettingsBtn').addEventListener('click', () => {
            saveSettings();
            panel.remove();
            location.reload();
        });

        document.getElementById('closeSettingsBtn').addEventListener('click', () => {
            panel.remove();
        });
    }

    console.log(`[FMHY Guard] Unsafe Domains: ${unsafeDomains.size}, Safe Domains: ${safeDomains.size}`);
    const unsafeCache = GM_getValue(CACHE_KEYS.UNSAFE);
    if (unsafeCache) console.log(`[FMHY Guard] Cache Size: ${JSON.stringify(unsafeCache).length} bytes`);

})();