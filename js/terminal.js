/* Interfaz del simulador: terminal (Linux / PowerShell) + panel de ejercicios. */
(function () {
  "use strict";
  var Sim = window.Sim, root = document.getElementById("sim-root");
  if (!root || !Sim) return;

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") el.className = attrs[k]; else if (k === "html") el.innerHTML = attrs[k]; else if (k === "text") el.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]); else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { } return null; }

  /* ---- ANSI -> HTML ---- */
  function ansi(s) {
    var out = "", st = {};
    s.split(/(\x1b\[[0-9;]*[mK])/).forEach(function (tok) {
      var m = /^\x1b\[([0-9;]*)([mK])$/.exec(tok);
      if (!m) { if (!tok) return; var cls = []; if (st.b) cls.push("b"); if (st.rev) cls.push("rev"); if (st.fg) cls.push("f" + st.fg); if (st.bg) cls.push("g" + st.bg); out += cls.length ? '<span class="' + cls.join(" ") + '">' + esc(tok) + "</span>" : esc(tok); return; }
      if (m[2] === "K") return;
      (m[1] === "" ? [0] : m[1].split(";").map(Number)).forEach(function (c) {
        if (c === 0) st = {}; else if (c === 1) st.b = 1; else if (c === 7) st.rev = 1; else if (c === 27) st.rev = 0;
        else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) st.fg = c; else if (c >= 40 && c <= 47) st.bg = c;
      });
    });
    return out;
  }

  /* ---------------------------------------------------------- terminal */
  function Term(os, opts) {
    var self = this; this.os = os; this.opts = opts; this.hist = []; this.hp = 0; this.lastTab = 0;
    this.out = h("div", { class: "term-out" });
    this.prompt = h("span", { class: "term-prompt" });
    this.input = h("input", { class: "term-input", spellcheck: "false", autocomplete: "off", autocapitalize: "off", autocorrect: "off", "aria-label": os === "linux" ? "Terminal de Linux" : "Terminal de PowerShell" });
    this.title = h("span", { class: "term-title" });
    var line = h("div", { class: "term-line" }, [this.prompt, this.input]);
    this.body = h("div", { class: "term-body" }, [this.out, line]);
    var bar = h("div", { class: "term-bar" }, [h("span", { class: "dots" }, [h("i"), h("i"), h("i")]), this.title,
      h("div", { class: "term-actions" }, [h("button", { type: "button", onclick: function () { self.clear(); self.focus(); } }, ["Limpiar"])].concat(opts.extraButtons || []))]);
    this.el = h("div", { class: "term " + (os === "linux" ? "linux" : "ps"), role: "group", "aria-label": "Terminal" }, [bar, this.body]);
    this.body.addEventListener("mousedown", function (e) { if (e.target === self.body || e.target === self.out || e.target.closest(".term-line")) { setTimeout(function () { if (!String(getSelection())) self.input.focus(); }, 0); } });
    this.input.addEventListener("keydown", function (e) { self.key(e); });
  }
  Term.prototype.focus = function () { this.input.focus({ preventScroll: true }); };
  Term.prototype.clear = function () { this.out.innerHTML = ""; };
  Term.prototype.scroll = function () { this.body.scrollTop = this.body.scrollHeight; };
  Term.prototype.setPrompt = function (info) {
    if (this.os === "linux") { this.prompt.innerHTML = '<span class="u">' + esc(info.user + "@" + info.host) + '</span><span class="w">:</span><span class="p">' + esc(info.path) + '</span><span class="w">$ </span>'; this.title.textContent = info.user + "@" + info.host + ": " + info.path; }
    else { this.prompt.innerHTML = '<span class="pp">PS ' + esc(info.path) + "&gt; </span>"; this.title.textContent = "Windows PowerShell"; }
    this.curPrompt = this.prompt.innerHTML;
  };
  Term.prototype.echo = function (cmd) { this.out.appendChild(h("div", { class: "ln ln-cmd", html: this.curPrompt + "<span class=\"typed\">" + esc(cmd) + "</span>" })); };
  Term.prototype.printRes = function (res) {
    var self = this; if (res.clear) { this.clear(); return; }
    (res.text || []).forEach(function (seg) { if (!seg.s) return; self.out.appendChild(h("div", { class: "ln" + (seg.e ? " err" : ""), html: ansi(seg.s.replace(/\n$/, "")) || "&nbsp;" })); });
  };
  Term.prototype.note = function (txt) { this.out.appendChild(h("div", { class: "ln tnote", text: txt })); this.scroll(); };
  Term.prototype.key = function (e) {
    var self = this, inp = this.input;
    if (e.key === "Enter") {
      e.preventDefault(); var v = inp.value; inp.value = "";
      if (v.trim()) { this.hist.push(v); } this.hp = this.hist.length;
      this.opts.onRun(v); this.scroll(); return;
    }
    if (e.key === "ArrowUp") { e.preventDefault(); if (this.hp > 0) { this.hp--; inp.value = this.hist[this.hp]; setTimeout(function () { inp.setSelectionRange(inp.value.length, inp.value.length); }); } return; }
    if (e.key === "ArrowDown") { e.preventDefault(); if (this.hp < this.hist.length) { this.hp++; inp.value = this.hist[this.hp] || ""; } return; }
    if (e.ctrlKey && (e.key === "l" || e.key === "L")) { e.preventDefault(); this.clear(); return; }
    if (e.ctrlKey && (e.key === "c" || e.key === "C") && inp.selectionStart === inp.selectionEnd) { e.preventDefault(); this.echo(inp.value + "^C"); inp.value = ""; this.scroll(); return; }
    if (e.key === "Tab") { e.preventDefault(); this.complete(); return; }
  };
  Term.prototype.complete = function () {
    var inp = this.input, line = inp.value.slice(0, inp.selectionStart), rest = inp.value.slice(inp.selectionStart);
    var m = /^([\s\S]*?)(\S*)$/.exec(line), before = m[1], word = m[2], ps = this.os === "ps";
    var first = !/\S/.test(before) || /[|;]\s*$/.test(before) || /&&\s*$/.test(before) || (/^\s*sudo\s+$/.test(before));
    var sh = this.opts.shell(), cands = [], base = word, dirPart = "";
    var quote = /^["']/.test(word) ? word.charAt(0) : ""; if (quote) { word = word.slice(1); base = word; }
    var isPath = /[\\\/]/.test(word) || /^~/.test(word) || /^\./.test(word);
    if (first && !isPath) {
      var names = this.opts.commands(), lw = word.toLowerCase();
      cands = names.filter(function (n) { return n.toLowerCase().indexOf(lw) === 0; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
    } else {
      var sepIdx = Math.max(word.lastIndexOf("/"), ps ? word.lastIndexOf("\\") : -1);
      dirPart = sepIdx >= 0 ? word.slice(0, sepIdx + 1) : ""; base = word.slice(sepIdx + 1);
      var dirAbs;
      if (ps) { var ti = Sim.psToInt(dirPart || ".", sh.st.cwd); dirAbs = ti.err ? null : ti.p; }
      else dirAbs = dirPart ? (/^~/.test(dirPart) ? "/home/lliurex" + dirPart.slice(1) : dirPart) : sh.st.cwd;
      var r = dirAbs === null ? { id: null } : sh.fs.resolve(dirAbs || "/", sh.st.cwd);
      if (r.id !== null && sh.fs.node(r.id).type === "d") {
        var d = sh.fs.node(r.id), lb = base.toLowerCase();
        Object.keys(d.entries).sort().forEach(function (k) {
          if (k.charAt(0) === "." && base.charAt(0) !== ".") return;
          if (k.toLowerCase().indexOf(lb) === 0 && (ps || k.indexOf(base) === 0)) cands.push(k + (sh.fs.node(d.entries[k]).type === "d" ? (ps ? "\\" : "/") : ""));
        });
      }
    }
    if (!cands.length) return;
    var common = cands[0];
    cands.forEach(function (c) { var i = 0; while (i < common.length && i < c.length && common[i].toLowerCase() === c[i].toLowerCase()) i++; common = common.slice(0, i); });
    var done = quote + dirPart + common, isDir = cands.length === 1 && /[\\\/]$/.test(cands[0]);
    if (cands.length === 1 && !isDir && !/[\\\/]$/.test(cands[0])) done += " ";
    if (done.length > word.length + quote.length || cands.length === 1) { inp.value = before + done + rest; inp.setSelectionRange((before + done).length, (before + done).length); this.lastTab = 0; return; }
    var now = Date.now();
    if (now - this.lastTab < 700 || cands.length < 40) { this.echo(line); this.out.appendChild(h("div", { class: "ln", text: cands.join("  ") })); this.scroll(); }
    this.lastTab = now;
  };

  /* ---------------------------------------------------------- aplicacion */
  var app = { os: store("sim-os") === "ps" ? "ps" : "linux", mode: store("sim-mode") === "exam" ? "exam" : "practice", view: "home", serie: null, practice: null, free: { linux: null, ps: null }, term: null, verdict: null, showSteps: false };

  function shell() { return app.view === "free" ? app.free[app.os] : (app.practice ? app.practice.shell : null); }
  function promptInfo() { return shell().promptInfo(); }
  function commandNames() { return app.os === "linux" ? Sim.linuxCommandNames() : Sim.psCommandNames(); }

  function runInTerm(line) {
    var t = app.term, sh = shell();
    t.echo(line);
    if (line.trim()) { var res = sh.exec(line); t.printRes(res); }
    t.setPrompt(promptInfo()); t.scroll();
    if (app.practice) app.practice.save();
  }

  function makeTerm(extra) {
    var t = new Term(app.os, { onRun: runInTerm, shell: shell, commands: commandNames, extraButtons: extra });
    t.setPrompt(promptInfo()); app.term = t;
    t.note(app.os === "linux" ? "Terminal de Linux (bash). Tab autocompleta · ↑↓ historial · Ctrl+L limpia · escribe help para ver los comandos." : "Windows PowerShell (simulado). Tab autocompleta · ↑↓ historial · Get-Help lista los cmdlets.");
    return t;
  }

  /* ---------- pantallas ---------- */
  function mount(node) { root.innerHTML = ""; root.appendChild(node); }

  function seg(items, current, onpick, cls) {
    var wrap = h("div", { class: "segmented " + (cls || ""), role: "tablist" });
    items.forEach(function (it) { wrap.appendChild(h("button", { type: "button", role: "tab", "aria-selected": String(it.v === current), onclick: function () { onpick(it.v); } }, [it.label])); });
    return wrap;
  }

  function renderHome() {
    app.view = "home"; app.practice = null; app.term = null; app.verdict = null;
    var series = Sim.SERIES[app.os];
    var head = h("div", { class: "sim-hero" }, [
      h("div", {}, [h("p", { class: "eyebrow", text: "Simulador de examen" }), h("h2", { text: "Practica en una terminal de verdad (casi)" }),
        h("p", { class: "lead", html: "Escribe los comandos del examen en un terminal simulado de <b>Linux</b> o <b>PowerShell</b>. Los ejercicios son los del banco de preguntas, con el estado de ficheros que arrastras de un paso al siguiente, igual que en el examen." })]),
    ]);
    var ctrl = h("div", { class: "sim-controls" }, [
      seg([{ v: "linux", label: "Linux · bash" }, { v: "ps", label: "PowerShell" }], app.os, function (v) { app.os = v; store("sim-os", v); renderHome(); }),
      seg([{ v: "practice", label: "Práctica" }, { v: "exam", label: "Examen" }], app.mode, function (v) { app.mode = v; store("sim-mode", v); renderHome(); })
    ]);
    var modeInfo = h("div", { class: "modeinfo " + app.mode, html: app.mode === "exam"
      ? "<b>Modo examen:</b> la respuesta se compara <b>como texto</b>. Tiene que empezar por <code>" + (app.os === "linux" ? "$ " : "&gt; ") + "</code> y coincidir con la solución del profe. Sin pistas."
      : "<b>Modo práctica:</b> vale cualquier comando que haga lo que pide (te aviso de cuál es la solución del profe). Con pistas y sin necesidad de escribir <code>" + (app.os === "linux" ? "$" : "&gt;") + "</code>." });
    var grid = h("div", { class: "serie-grid" });
    var total = 0, doneAll = 0;
    series.forEach(function (s, i) {
      var items = Sim.seriesItems(app.os, s), pr = Sim.progressOf(app.os, s.id), done = pr ? Math.min(pr.idx, items.length) : 0, first = 0;
      if (pr) Object.keys(pr.results || {}).forEach(function (k) { if (pr.results[k] === "first") first++; });
      total += items.length; doneAll += done;
      var pct = Math.round(done / items.length * 100);
      grid.appendChild(h("button", { type: "button", class: "serie-card", onclick: function () { startSeries(s.id); } }, [
        h("span", { class: "serie-n", text: String(i + 1) }),
        h("span", { class: "serie-t", text: s.title }), h("span", { class: "serie-s", text: s.sub }),
        h("span", { class: "serie-meta" }, [h("span", { text: items.length + " ejercicios" }), h("span", { class: pct === 100 ? "done" : "", text: pct === 100 ? "✓ completada · " + first + " a la primera" : done ? done + "/" + items.length : "sin empezar" })]),
        h("span", { class: "pbar" }, [h("i", { style: "width:" + pct + "%" })])
      ]));
    });
    grid.appendChild(h("button", { type: "button", class: "serie-card free", onclick: startFree }, [
      h("span", { class: "serie-n", text: "›_" }), h("span", { class: "serie-t", text: "Terminal libre" }),
      h("span", { class: "serie-s", text: "Sin ejercicios: prueba comandos, rompe cosas y reinicia cuando quieras." }),
      h("span", { class: "serie-meta" }, [h("span", { text: "Sandbox" })])
    ]));
    var wrap = h("div", { class: "sim-home" }, [head, ctrl, modeInfo, grid,
      h("p", { class: "sim-foot", text: "Progreso guardado en este navegador (" + doneAll + "/" + total + " ejercicios hechos en " + (app.os === "linux" ? "Linux" : "PowerShell") + "). El simulador no toca tu ordenador: todo ocurre en la página." }),
      doneAll ? h("button", { type: "button", class: "ghost", onclick: function () { if (confirm("¿Borrar el progreso de " + (app.os === "linux" ? "Linux" : "PowerShell") + "?")) { series.forEach(function (s) { try { localStorage.removeItem("prog-" + app.os + "-" + s.id); } catch (e) { } }); renderHome(); } } }, ["Borrar progreso"]) : null]);
    mount(wrap);
  }

  function startSeries(id) {
    app.view = "series"; app.verdict = null;
    app.practice = new Sim.Practice(app.os, id);
    app.practice.exam = app.mode === "exam";
    if (app.mode === "practice") app.practice.load();
    renderSession();
  }
  function startFree() {
    app.view = "free"; app.practice = null;
    if (!app.free[app.os]) app.free[app.os] = Sim.newShell(app.os);
    renderFree();
  }

  var TRY = {
    linux: ["ls -l /etc", "cat /etc/passwd | cut -d \":\" -f1 | sort", "mkdir -p a/b/c && tree a", "echo hola > f.txt; ln -s f.txt s.txt; ls -li", "ps aux --sort -%cpu | head -n 5", "date +\"%Y-%m-%d\"; cal", "chmod 640 f.txt && ls -l f.txt", "free -h; df -h"],
    ps: ["Get-ChildItem C:\\", "New-Item -ItemType Directory -Name PS", "Get-Service | Where-Object Status -eq \"Running\"", "Get-Process | Sort-Object CPU -Descending | Select-Object -First 5", "systeminfo | Select-String \"Nombre\"", "Write-Output \"Hola\" | Out-File a.txt", "Get-Content a.txt", "Get-ComputerInfo -Property csname"]
  };
  function renderFree() {
    var back = h("button", { type: "button", class: "ghost back", onclick: renderHome }, ["← Series"]);
    var reset = h("button", { type: "button", onclick: function () { app.free[app.os] = Sim.newShell(app.os); app.term.clear(); app.term.setPrompt(promptInfo()); app.term.note("Estado reiniciado."); app.term.focus(); } }, ["Reiniciar"]);
    var term = makeTerm([reset]);
    var tips = h("div", { class: "card tips" }, [h("h3", { text: "Prueba esto" }), h("p", { class: "muted", text: "Pulsa un ejemplo para ejecutarlo en el terminal." })]);
    TRY[app.os].forEach(function (c) { tips.appendChild(h("button", { type: "button", class: "try", onclick: function () { runInTerm(c); term.focus(); } }, [h("code", { text: c })])); });
    var cols = h("div", { class: "sim-cols" }, [h("div", { class: "sim-left" }, [h("div", { class: "sim-top" }, [back, h("h3", { text: "Terminal libre · " + (app.os === "linux" ? "Linux" : "PowerShell") })]), tips]), h("div", { class: "sim-right" }, [term.el])]);
    mount(cols); term.focus();
  }

  function renderSession() {
    var P = app.practice, back = h("button", { type: "button", class: "ghost back", onclick: function () { P.save(); renderHome(); } }, ["← Series"]);
    var resetBtn = h("button", { type: "button", onclick: function () { if (confirm("¿Empezar la serie desde el principio?")) { P.reset(); try { localStorage.removeItem("prog-" + P.os + "-" + P.serie.id); } catch (e) { } app.verdict = null; renderSession(); } } }, ["Reiniciar serie"]);
    var restoreBtn = h("button", { type: "button", title: "Vuelve a dejar los ficheros como estaban antes de tus pruebas en el terminal", onclick: function () { var idx = P.idx, res = P.results; P.reset(); for (var i = 0; i < idx; i++) P.runRef(P.shell, P.items[i]); P.idx = idx; P.results = res; app.term.setPrompt(promptInfo()); app.term.note("Estado de ficheros restaurado al punto del ejercicio actual."); } }, ["Restaurar estado"]);
    var term = makeTerm([restoreBtn]);
    var left = h("div", { class: "sim-left" });
    left.appendChild(h("div", { class: "sim-top" }, [back, h("div", { class: "sim-title" }, [h("h3", { text: P.serie.title }), h("span", { class: "muted", text: P.serie.sub })])]));
    var modeSw = seg([{ v: "practice", label: "Práctica" }, { v: "exam", label: "Examen" }], app.mode, function (v) { app.mode = v; store("sim-mode", v); P.exam = v === "exam"; app.verdict = null; renderSession(); }, "small");
    var card = h("div", { class: "card ex-card", id: "ex-card" });
    left.appendChild(h("div", { class: "sim-tools" }, [modeSw, resetBtn]));
    left.appendChild(card);
    var steps = h("div", { class: "steps", id: "steps" }); left.appendChild(steps);
    var cols = h("div", { class: "sim-cols" }, [left, h("div", { class: "sim-right" }, [term.el])]);
    mount(cols);
    drawExercise();
    term.focus();
  }

  function stepsView() {
    var P = app.practice, el = document.getElementById("steps"); if (!el) return;
    el.innerHTML = "";
    var sc = P.score();
    el.appendChild(h("div", { class: "steps-head" }, [h("span", { text: "Progreso" }), h("b", { text: sc.done + " / " + sc.total })]));
    el.appendChild(h("div", { class: "pbar big" }, [h("i", { style: "width:" + Math.round(sc.done / sc.total * 100) + "%" })]));
    var dots = h("div", { class: "dots-row" });
    P.items.forEach(function (it, i) {
      var r = P.results[it.id], cls = "dot" + (r ? " " + r : "") + (i === P.idx ? " cur" : "");
      dots.appendChild(h("span", { class: cls, title: it.id + (r === "skip" ? " · saltada" : r === "first" ? " · a la primera" : r === "ok" ? " · con ayuda" : "") }));
    });
    el.appendChild(dots);
    el.appendChild(h("div", { class: "legend" }, [h("span", { class: "dot first" }), " a la primera ", h("span", { class: "dot ok" }), " con fallos/pistas ", h("span", { class: "dot skip" }), " saltada ", h("span", { class: "dot cur" }), " actual"]));
  }

  function verdictEl() {
    var v = app.verdict; if (!v) return null;
    return h("div", { class: "verdict " + v.kind, role: "status" }, [h("b", { text: v.title }), v.msg ? h("span", { text: v.msg }) : null, v.extra ? h("span", { class: "extra", text: v.extra }) : null]);
  }

  function drawExercise() {
    var P = app.practice, card = document.getElementById("ex-card"); if (!card) return;
    card.innerHTML = ""; stepsView();
    if (P.finished()) return drawFinished(card);
    var ex = P.current(), exam = P.exam, sig = P.sigil();
    card.appendChild(h("div", { class: "ex-meta" }, [h("span", { class: "ex-id", text: (P.os === "linux" ? "Pregunta " : "Ejercicio ") + ex.id }), h("span", { class: "muted", text: (P.idx + 1) + " de " + P.items.length }), P.attempts[ex.id] ? h("span", { class: "tries", text: P.attempts[ex.id] + (P.attempts[ex.id] === 1 ? " intento" : " intentos") }) : null]));
    card.appendChild(h("p", { class: "ex-q", text: ex.q }));
    var vd = verdictEl(); if (vd) card.appendChild(vd);
    var input = h("input", { id: "ans", class: "ans", spellcheck: "false", autocomplete: "off", autocapitalize: "off", placeholder: exam ? (ex.concept ? "solo la palabra o el número" : sig + "comando") : (ex.concept ? "respuesta corta (palabra o número)" : "escribe el comando"), "aria-label": "Tu respuesta" });
    var form = h("form", { class: "ans-form", onsubmit: function (e) { e.preventDefault(); submit(input.value); } }, [
      h("span", { class: "sig" + (exam || ex.concept ? " hide" : ""), text: ex.concept ? "" : sig.trim() }), input,
      h("button", { type: "submit", class: "primary" }, ["Comprobar"])
    ]);
    card.appendChild(form);
    var row = h("div", { class: "ex-actions" });
    if (!exam) row.appendChild(h("button", { type: "button", class: "ghost", onclick: function () { app.verdict = { kind: "hint", title: "Pista", msg: P.hint() }; P.save(); drawExercise(); focusAns(); } }, ["Pista"]));
    row.appendChild(h("button", { type: "button", class: "ghost", onclick: function () { reveal(); } }, ["Ver solución y seguir"]));
    row.appendChild(h("button", { type: "button", class: "ghost", onclick: function () { skip(); } }, ["Saltar"]));
    card.appendChild(row);
    if (ex.flag === 1 && ex.mine && !exam) card.appendChild(h("p", { class: "mine", html: "En tu examen respondiste <code>" + esc(ex.mine) + "</code> y falló." }));
    form.addEventListener("keydown", function (e) { if (e.key === "ArrowUp") { var hh = app.term.hist; if (hh.length && !input.value) { input.value = hh[hh.length - 1]; e.preventDefault(); } } });
  }
  function focusAns() { var a = document.getElementById("ans"); if (a) a.focus(); }

  function submit(text) {
    var P = app.practice, ex = P.current(); if (!ex) return;
    var before = promptInfo(), t = app.term;
    var r = P.submit(text);
    if (r.res) { var saved = t.curPrompt; t.setPrompt(before); t.echo(r.cmd); t.printRes(r.res); }
    t.setPrompt(promptInfo()); t.scroll();
    if (r.ok) {
      app.verdict = { kind: "ok", title: "✓ " + ex.id + (r.kind === "equiv" ? " correcto (otra forma)" : " correcto"), msg: r.msg, extra: ex.note ? "Recuerda: " + ex.note : "" };
    } else {
      var att = P.attempts[ex.id];
      app.verdict = { kind: "bad", title: r.kind === "format" ? "Formato" : "✗ No es correcto", msg: r.msg, extra: (!P.exam && att >= 2 && ex.note) ? "Ojo: " + ex.note : "" };
      if (r.res && r.kind === "wrong") t.out.appendChild(h("div", { class: "ln tnote", text: "↺ Intento incorrecto: los ficheros vuelven a como estaban antes." }));
      t.scroll();
    }
    P.save(); drawExercise(); focusAns();
    if (!r.ok) { var c = document.getElementById("ex-card"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake"); var a = document.getElementById("ans"); if (a) { a.value = text; a.select(); } }
  }
  function applySolution(verdict) {
    var P = app.practice, ex = P.current(), t = app.term; if (!ex) return;
    var before = promptInfo(), res = P.skip();
    if (!ex.concept) { var cur = t.curPrompt; t.setPrompt(before); t.echo(ex.sol); t.printRes(res); }
    app.verdict = verdict(ex);
    P.save(); t.setPrompt(promptInfo()); t.scroll(); drawExercise(); focusAns();
  }
  function reveal() { applySolution(function (ex) { return { kind: "info", title: "Solución de " + ex.id, msg: (ex.concept ? "" : app.practice.sigil()) + ex.sol, extra: ex.note ? "Ojo: " + ex.note : "" }; }); }
  function skip() { applySolution(function (ex) { return { kind: "info", title: ex.id + " saltada", msg: "He aplicado la solución para que el estado cuadre con la siguiente pregunta: " + (ex.concept ? ex.sol : app.practice.sigil() + ex.sol) }; }); }

  function drawFinished(card) {
    var P = app.practice, sc = P.score(), exam = P.exam;
    var grade = Math.round((sc.first + sc.ok * 0.5) / sc.total * 100) / 10;
    card.appendChild(h("div", { class: "finish" }, [
      h("p", { class: "eyebrow", text: "Serie terminada" }), h("h3", { text: P.serie.title }),
      h("div", { class: "score" }, [h("div", {}, [h("b", { text: String(sc.first) }), h("span", { text: "a la primera" })]), h("div", {}, [h("b", { text: String(sc.ok) }), h("span", { text: "con fallos o pistas" })]), h("div", {}, [h("b", { text: String(sc.skip) }), h("span", { text: "saltadas" })]), h("div", { class: "grade" }, [h("b", { text: String(grade).replace(".", ",") }), h("span", { text: "nota sobre 10" })])])
    ]));
    var weak = P.items.filter(function (it) { return P.results[it.id] && P.results[it.id] !== "first"; });
    if (weak.length) {
      var ul = h("ul", { class: "weak" });
      weak.forEach(function (it) { ul.appendChild(h("li", {}, [h("b", { text: it.id + " " }), it.q, h("code", { text: (it.concept ? "" : P.sigil()) + it.sol })])); });
      card.appendChild(h("div", { class: "weak-wrap" }, [h("h4", { text: "Repasa estas (" + weak.length + ")" }), ul]));
    } else card.appendChild(h("p", { class: "ok-all", text: "¡Todas a la primera! 🎯" }));
    var list = Sim.SERIES[P.os], i = list.indexOf(P.serie), nxt = list[i + 1];
    card.appendChild(h("div", { class: "ex-actions" }, [
      h("button", { type: "button", class: "primary", onclick: function () { P.reset(); try { localStorage.removeItem("prog-" + P.os + "-" + P.serie.id); } catch (e) { } app.verdict = null; renderSession(); } }, ["Repetir serie"]),
      nxt ? h("button", { type: "button", class: "ghost", onclick: function () { startSeries(nxt.id); } }, ["Siguiente: " + nxt.title]) : null,
      h("button", { type: "button", class: "ghost", onclick: renderHome }, ["Todas las series"])
    ]));
  }

  app.setOs = function (os) { app.os = os === "ps" ? "ps" : "linux"; store("sim-os", app.os); renderHome(); };
  renderHome();
  window.Sim.app = app;
})();
