// Utils.js — kopīgās palīgfunkcijas, kas pirms šīs faila bija dublikētas
// trim vietās (login.js, admin.js, control.js). Tagad viens avots, visi
// kontroleerji to lieto atkārtoti.
(function () {
  'use strict';

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function roleColor(role) {
    const r = (role || '').toLowerCase();
    if (r === 'administrators' || r === 'admins' || r === 'admin') return 'var(--danger)';
    if (r === 'kontroliere' || r === 'kontrolieris' || r === 'controller') return 'var(--primary-light)';
    return 'var(--accent)';
  }

  function roleColorAlpha(role) {
    const r = (role || '').toLowerCase();
    if (r === 'administrators' || r === 'admins' || r === 'admin') return 'rgba(231,76,60,0.25)';
    if (r === 'kontroliere' || r === 'kontrolieris' || r === 'controller') return 'rgba(52,152,219,0.25)';
    return 'rgba(39,174,96,0.25)';
  }

  function roleLabel(role, style) {
    const mShort = {
      'administrators': 'Admin',
      'kontroliere': 'Kontrole',
      'aprūpētājs': 'Aprūpe'
    };
    const mEmoji = {
      'administrators': '👑 Admin',
      'kontroliere': '📊 Kontrole',
      'aprūpētājs': '🤝 Aprūpe'
    };
    const mFull = {
      'administrators': 'Administrators',
      'kontroliere': 'Kontrolieris',
      'aprūpētājs': 'Aprūpētājs'
    };
    const key = (role || '').toLowerCase();
    if (style === 'emoji') return mEmoji[key] || role;
    if (style === 'full') return mFull[key] || role;
    return mShort[key] || role;
  }

  window.Utils = {
    escapeHtml: escapeHtml,
    roleColor: roleColor,
    roleColorAlpha: roleColorAlpha,
    roleLabel: roleLabel
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml, roleColor, roleColorAlpha, roleLabel };
  }
})();
