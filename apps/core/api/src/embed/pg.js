/* Codegreene module tag loader v1.0.0
 * Place tags on any site, e.g. <pg-contact-form site="sunny" copy="live" form="main" api="https://app.codegreene.com"><p>Call us on ...</p></pg-contact-form>
 * The tag's own content is the fallback: it stays visible if the app cannot be reached. */
(function () {
  'use strict';
  if (window.__pgLoader) return; window.__pgLoader = '1.0.0';
  var uid = 0;
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === 'text') e.textContent = attrs[k]; else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function api(host, path, opt) {
    var ctl = 'AbortController' in window ? new AbortController() : null;
    var t = setTimeout(function () { ctl && ctl.abort(); }, 6000);
    return fetch(host.base + '/api/public/' + encodeURIComponent(host.site) + '/' + host.copy + path, Object.assign({signal: ctl && ctl.signal, credentials: 'omit', headers: {'Content-Type': 'application/json'}}, opt || {}))
      .then(function (r) { clearTimeout(t); return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; }); });
  }
  function hostOf(node) {
    return {site: node.getAttribute('site') || '', copy: node.getAttribute('copy') === 'test' ? 'test' : 'live', base: (node.getAttribute('api') || 'https://app.codegreene.com').replace(/\/$/, '')};
  }
  function css() {
    if (document.getElementById('pg-style')) return;
    var s = document.createElement('style'); s.id = 'pg-style';
    s.textContent = '.pg-form{display:grid;gap:.9rem}.pg-form label{font-weight:600;display:block;margin-bottom:.25rem}.pg-form input,.pg-form textarea,.pg-form select{width:100%;padding:.75rem;border:1px solid #94a3b8;border-radius:.6rem;font:inherit;background:#fff}.pg-form textarea{min-height:7rem}.pg-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.pg-msg{padding:.8rem 1rem;border-radius:.6rem;background:#ecfdf5;color:#065f46}.pg-msg.err{background:#fef2f2;color:#991b1b}.pg-slots{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;padding:0}.pg-slots button{padding:.6rem .9rem;border-radius:.6rem;border:1px solid #94a3b8;background:#fff;cursor:pointer;font:inherit}.pg-slots button[aria-pressed=true]{background:#0f766e;color:#fff;border-color:#0f766e}.pg-btn{background:#0f766e;color:#fff;border:0;border-radius:.7rem;padding:.8rem 1.3rem;font-weight:600;font:inherit;cursor:pointer}.pg-step{font-size:.9rem;color:#475569}';
    document.head.appendChild(s);
  }
  function field(f, idp) {
    var id = idp + f.key, input;
    if (f.type === 'textarea') input = el('textarea', {id: id, name: f.key, required: !!f.required});
    else if (f.type === 'choice') { input = el('select', {id: id, name: f.key, required: !!f.required}, [el('option', {value: '', text: 'Pick one'})].concat((f.options || []).map(function (o) { return el('option', {value: o, text: o}); }))); }
    else input = el('input', {id: id, name: f.key, type: f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text', required: !!f.required, autocomplete: f.key === 'name' ? 'name' : f.key === 'email' ? 'email' : f.key === 'phone' ? 'tel' : 'off'});
    return el('div', {}, [el('label', {for: id, text: (f.label || f.question || f.key) + (f.required ? ' *' : '')}), input]);
  }
  function status(box, text, isErr) { box.textContent = text; box.className = 'pg-msg' + (isErr ? ' err' : ''); box.hidden = false; box.focus && box.focus(); }
  function hp() { return el('div', {class: 'pg-hp', 'aria-hidden': 'true'}, [el('label', {for: 'pg-hp-' + (++uid), text: 'Leave empty'}), el('input', {id: 'pg-hp-' + uid, name: 'website', tabindex: '-1', autocomplete: 'off'})]); }
  function formData(form) { var o = {}; new FormData(form).forEach(function (v, k) { o[k] = v; }); return o; }

  function mountContact(node) {
    var h = hostOf(node), id = node.getAttribute('form') || 'main';
    api(h, '/form/' + encodeURIComponent(id)).then(function (f) {
      css();
      var idp = 'pg' + (++uid) + '-';
      var msg = el('p', {class: 'pg-msg', role: 'status', tabindex: '-1', hidden: true});
      var fields = f.fields.map(function (x) { return field(x, idp); });
      (f.customFields || []).forEach(function (c) { fields.push(field({key: 'custom_' + c.key, label: c.label, type: c.type === 'yesno' ? 'choice' : c.type, options: c.type === 'yesno' ? ['Yes', 'No'] : c.options}, idp)); });
      var btn = el('button', {type: 'submit', class: 'pg-btn', text: 'Send'});
      var form = el('form', {class: 'pg-form', novalidate: false, 'aria-label': f.title}, fields.concat([hp(), btn]));
      form.addEventListener('submit', function (e) {
        e.preventDefault(); btn.disabled = true;
        api(h, '/form/' + encodeURIComponent(id), {method: 'POST', body: JSON.stringify(formData(form))})
          .then(function (r) { form.hidden = true; status(msg, r.message || 'Thank you!'); })
          .catch(function (er) { status(msg, er.message, true); })
          .then(function () { btn.disabled = false; });
      });
      node.replaceChildren(form, msg);
    }).catch(function () { /* keep the fallback */ });
  }

  function mountFunnel(node) {
    var h = hostOf(node), id = node.getAttribute('funnel') || 'main';
    api(h, '/funnel/' + encodeURIComponent(id)).then(function (f) {
      css();
      var idp = 'pg' + (++uid) + '-', i = 0, answers = {};
      var msg = el('p', {class: 'pg-msg', role: 'status', tabindex: '-1', hidden: true});
      var wrap = el('div', {});
      function show() {
        var s = f.steps[i];
        var fld = field({key: s.key, label: s.question, type: s.type, options: s.options, required: s.required !== false}, idp);
        var back = i > 0 ? el('button', {type: 'button', class: 'pg-btn', text: 'Back', style: 'background:#64748b'}) : null;
        var next = el('button', {type: 'submit', class: 'pg-btn', text: i === f.steps.length - 1 ? 'Send' : 'Next'});
        var form = el('form', {class: 'pg-form', 'aria-label': f.title}, [el('p', {class: 'pg-step', text: 'Step ' + (i + 1) + ' of ' + f.steps.length}), fld, hp(), el('div', {style: 'display:flex;gap:.5rem'}, [back, next])]);
        if (back) back.addEventListener('click', function () { i--; show(); });
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var d = formData(form); answers[s.key] = d[s.key]; if (d.website) answers.website = d.website;
          if (i < f.steps.length - 1) { i++; show(); return; }
          next.disabled = true;
          api(h, '/funnel/' + encodeURIComponent(id), {method: 'POST', body: JSON.stringify(answers)})
            .then(function (r) { wrap.hidden = true; status(msg, r.message || 'Thank you!'); })
            .catch(function (er) { status(msg, er.message, true); next.disabled = false; });
        });
        wrap.replaceChildren(form);
        var first = form.querySelector('input,select,textarea'); if (first && i > 0) first.focus();
      }
      node.replaceChildren(el('h3', {text: f.title}), wrap, msg); show();
    }).catch(function () {});
  }

  function mountBooking(node) {
    var h = hostOf(node);
    api(h, '/bookings').then(function (cfg) {
      css();
      if (cfg.mode === 'calendly' && cfg.calendlyUrl) {
        node.replaceChildren(el('p', {}, [el('a', {class: 'pg-btn', href: cfg.calendlyUrl, target: '_blank', rel: 'noopener', text: 'Pick a time (opens Calendly)'})]));
        return;
      }
      var idp = 'pg' + (++uid) + '-', chosen = null;
      var msg = el('p', {class: 'pg-msg', role: 'status', tabindex: '-1', hidden: true});
      var date = el('input', {type: 'date', id: idp + 'date', min: new Date().toISOString().slice(0, 10)});
      var list = el('ul', {class: 'pg-slots', 'aria-label': 'Free times'});
      var form = el('form', {class: 'pg-form', hidden: true}, [field({key: 'name', label: 'Your name', required: true}, idp), field({key: 'email', label: 'Your email', type: 'email', required: true}, idp), field({key: 'phone', label: 'Your phone number', type: 'tel'}, idp), field({key: 'note', label: 'Anything we should know?', type: 'textarea'}, idp), hp(), el('button', {type: 'submit', class: 'pg-btn', text: 'Book this time'})]);
      date.addEventListener('change', function () {
        list.replaceChildren(el('li', {text: 'Looking for free times…'})); form.hidden = true;
        api(h, '/bookings/slots?date=' + encodeURIComponent(date.value)).then(function (r) {
          if (!r.slots.length) { list.replaceChildren(el('li', {text: 'No free times on this day. Please try another day.'})); return; }
          list.replaceChildren.apply(list, r.slots.map(function (s) {
            var b = el('button', {type: 'button', 'aria-pressed': 'false', text: s.label});
            b.addEventListener('click', function () { list.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); chosen = s.start; form.hidden = false; });
            return el('li', {}, [b]);
          }));
        }).catch(function (er) { status(msg, er.message, true); });
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault(); var d = formData(form); d.start = chosen;
        api(h, '/bookings', {method: 'POST', body: JSON.stringify(d)}).then(function (r) { form.hidden = true; list.hidden = true; status(msg, r.message); }).catch(function (er) { status(msg, er.message, true); });
      });
      node.replaceChildren(el('div', {class: 'pg-form'}, [el('div', {}, [el('label', {for: idp + 'date', text: 'Pick a day (times are in ' + cfg.timezone + ')'}), date]), list, form]), msg);
    }).catch(function () {});
  }

  function scan() {
    document.querySelectorAll('pg-contact-form:not([data-pg]),pg-funnel:not([data-pg]),pg-booking:not([data-pg])').forEach(function (n) {
      n.setAttribute('data-pg', '1');
      var t = n.tagName.toLowerCase();
      if (t === 'pg-contact-form') mountContact(n); else if (t === 'pg-funnel') mountFunnel(n); else mountBooking(n);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
})();
