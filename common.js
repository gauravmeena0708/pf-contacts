/* Shared data layer + helpers for the EPFO Directory prototypes.
   Loads the SAME data files the production page uses (one level up).
   Exposed as a global `EPFO` object (no build step). */
const EPFO = (function () {
    const DATA_BASE = '.';
    let _contacts = [];
    let _geocodes = {};
    const _byQuery = new Map();
    const _byHierarchyValue = new Map();

    function escapeHtml(v) {
        if (v == null) return '';
        return String(v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function officeName(ct) {
        return ct.office_name_hierarchical || (ct.office && ct.office.office_name) || 'EPFO Office';
    }
    function breadcrumbs(ct) { return ct.hierarchy_breadcrumbs || []; }
    function normalizeHierarchyValue(v) {
        return String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }
    function queryValue(ct) {
        const query = String((ct && ct.query) || '');
        const raw = query.includes('=') ? query.slice(query.indexOf('=') + 1) : query;
        try {
            return decodeURIComponent(raw.replace(/\+/g, ' '));
        } catch (_) {
            return raw.replace(/\+/g, ' ');
        }
    }
    function addHierarchyValue(value, ct) {
        const key = normalizeHierarchyValue(value);
        if (key && !_byHierarchyValue.has(key)) _byHierarchyValue.set(key, ct);
    }
    function contactForHierarchyValue(value) {
        return _byHierarchyValue.get(normalizeHierarchyValue(value)) || null;
    }
    function parentValue(ct) {
        const b = breadcrumbs(ct);
        return b.length ? b[b.length - 1].query_param : '';
    }
    function parentOf(ct) {
        const b = breadcrumbs(ct);
        const topLevel = b.length === 1;
        const topCode = b[0] && b[0].query_param;
        if (topLevel && topCode !== 'HO' && topCode !== 'HH' && topCode !== 'GH') {
            return _contacts.find(c => officeType(c).code === 'HO') || null;
        }
        const parent = contactForHierarchyValue(parentValue(ct));
        return parent && parent !== ct ? parent : null;
    }
    function compareOfficeName(a, b) {
        return officeName(a).localeCompare(officeName(b));
    }
    function childrenOf(ct) {
        if (officeType(ct).code === 'HO') {
            return _contacts
                .filter(c => {
                    const b = breadcrumbs(c);
                    const code = b[0] && b[0].query_param;
                    return c !== ct && b.length === 1 && code !== 'HO' && code !== 'HH' && code !== 'GH';
                })
                .sort(compareOfficeName);
        }
        const currentValue = normalizeHierarchyValue(queryValue(ct));
        if (!currentValue) return [];
        return _contacts
            .filter(c => c !== ct && normalizeHierarchyValue(parentValue(c)) === currentValue)
            .sort(compareOfficeName);
    }
    function siblingsOf(ct) {
        const pValue = normalizeHierarchyValue(parentValue(ct));
        if (!pValue) return [];
        return _contacts
            .filter(c => c !== ct && normalizeHierarchyValue(parentValue(c)) === pValue)
            .sort(compareOfficeName);
    }

    // Office level is real, routable information — derive a tag from the hierarchy depth.
    function officeType(ct) {
        const b = breadcrumbs(ct);
        const qp0 = b[0] && b[0].query_param;
        if (qp0 === 'HO' || /HEAD\+?OFFICE/i.test(ct.query || '')) return { code: 'HO', label: 'Head Office' };
        if (qp0 === 'HH') return { code: 'HH', label: 'Holiday Home' };
        if (qp0 === 'GH') return { code: 'GH', label: 'Guest House' };
        if (qp0 === 'ApexBodies' || qp0 === 'PDUNASS') return { code: 'AP', label: 'Apex / Training' };
        if (b.length <= 1) return { code: 'ZO', label: 'Zonal Office' };
        if (b.length === 2) return { code: 'RO', label: 'Regional Office' };
        return { code: 'DO', label: 'District Office' };
    }

    function pin(ct) {
        const a = (ct.office && ct.office.office_address) || '';
        const m = String(a).match(/\b(\d{6})\b/);
        return m ? m[1] : '';
    }
    function hasLatLng(ct) {
        return ct.office && ct.office.latitude != null && ct.office.longitude != null;
    }
    function phones(ct) {
        const o = ct.office || {};
        return [...(o.pro_numbers || []), ...(o.phone_numbers_direct || [])];
    }

    function telLink(std, num) {
        if (!num && num !== 0) return '';
        num = String(num).trim();
        if (num === '') return '';
        const disp = std ? `(${String(std).trim()}) ${num}` : num;
        const full = (std ? String(std).trim() : '') + num;
        if (!/^[\d+\s()/-]+$/.test(full)) return escapeHtml(disp);
        return `<a href="tel:${full.replace(/[^\d+]/g, '')}">${escapeHtml(disp)}</a>`;
    }
    function mailLink(e) {
        if (!e || String(e).toLowerCase() === 'null') return '';
        e = String(e).trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return escapeHtml(e);
        return `<a href="mailto:${e}">${escapeHtml(e)}</a>`;
    }

    function field(label, val, mono) {
        if (!val) return '';
        return `<div class="field"><div class="flabel">${label}</div><div class="fval ${mono ? 'mono' : ''}">${val}</div></div>`;
    }

    // The shared office-detail card, reused by all three layouts.
    function renderDetail(ct) {
        if (!ct) return '<p class="empty">Select an office to see its contacts.</p>';
        const o = ct.office || {};
        const t = officeType(ct);
        const b = breadcrumbs(ct);

        let h = `<div class="detail-head"><span class="tag tag-${t.code}">${t.code}</span>` +
            `<h2>${escapeHtml(officeName(ct))}</h2></div>`;
        if (b.length) h += `<nav class="crumbs">${b.map(x => escapeHtml(x.name)).join(' <span>▸</span> ')}</nav>`;

        let fields = '';
        if (o.office_address && o.office_address !== 'STD-Code :') {
            fields += field('Address', escapeHtml(String(o.office_address)).replace(/\n/g, '<br>'));
        }
        if (o.toll_free_no) fields += field('Toll-free', telLink(null, o.toll_free_no), true);
        const ph = phones(ct).map(n => telLink(o.std_code, n)).filter(Boolean);
        if (ph.length) fields += field('Phone', ph.join('<br>'), true);
        if ((o.fax_numbers || []).length) fields += field('Fax', o.fax_numbers.map(n => escapeHtml(String(n))).join('<br>'), true);
        if (o.office_email) fields += field('Email', mailLink(o.office_email), true);
        const p = pin(ct);
        if (p) fields += field('PIN', p, true);
        if (fields) h += `<div class="fields">${fields}</div>`;

        const offs = ct.officials || [];
        if (offs.length) {
            h += `<h3 class="offs-title">Officials <span class="count">${offs.length}</span></h3><ul class="offs">`;
            offs.forEach(of => {
                h += `<li><div class="off-name">${escapeHtml(of.name) || '—'}</div>`;
                if (of.designation) h += `<div class="off-desig">${escapeHtml(of.designation)}</div>`;
                const opn = (of.phone_numbers || []).map(n => telLink(o.std_code, n)).filter(Boolean);
                if (opn.length) h += `<div class="off-line mono">☎ ${opn.join(', ')}</div>`;
                if (of.email) h += `<div class="off-line mono">✉ ${mailLink(of.email)}</div>`;
                h += `</li>`;
            });
            h += `</ul>`;
        }
        return h;
    }

    async function load() {
        const get = (f) => fetch(`${DATA_BASE}/${f}`).then(r => {
            if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
            return r.json();
        });
        const [c, g] = await Promise.all([get('contacts-data.json'), get('geocodes.json')]);
        _contacts = Array.isArray(c) ? c : [];
        _geocodes = (g && typeof g === 'object') ? g : {};
        _byQuery.clear();
        _byHierarchyValue.clear();
        _contacts.forEach(ct => {
            const name = officeName(ct);
            if (name && _geocodes[name]) {
                if (!ct.office) ct.office = {};
                ct.office.latitude = _geocodes[name][0];
                ct.office.longitude = _geocodes[name][1];
            }
            _byQuery.set(ct.query, ct);
            addHierarchyValue(queryValue(ct), ct);
            addHierarchyValue(name, ct);
        });
        return { contacts: _contacts };
    }

    return {
        load,
        all: () => _contacts,
        byQuery: (q) => _byQuery.get(q),
        officeName, breadcrumbs, officeType, pin, hasLatLng, phones,
        queryValue, contactForHierarchyValue, parentOf, childrenOf, siblingsOf,
        escapeHtml, telLink, mailLink, renderDetail,
    };
})();
