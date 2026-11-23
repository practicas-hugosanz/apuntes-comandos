/* Simulador de PowerShell 5.1 (Windows, textos en castellano).
   Soporta cmdlets habituales, alias, tuberias con objetos, ; > >> y script blocks sencillos. */
(function (g) {
  "use strict";
  var Sim = g.Sim = g.Sim || {};
  var VFS = g.VFS;
  var C = { reset: "\x1b[0m", dir: "\x1b[01;34m" };

  /* ---------------------------------------------------------- estado inicial */
  Sim.newPSState = function () {
    var fs = VFS.create(), v = new VFS(fs, true);
    ["Users", "Users/alumno", "Users/alumno/Desktop", "Users/alumno/Documents", "Users/alumno/Downloads", "Windows", "Windows/System32", "Program Files", "Program Files (x86)", "PerfLogs"].forEach(function (d) { v.mkdir("/" + d, "/", true); });
    var svc = function (n, d, s) { return { name: n, display: d, status: s }; };
    return {
      kind: "ps", fs: fs, cwd: "/", hist: [], vars: {}, nextPid: 7480,
      services: [
        svc("Audiosrv", "Audio de Windows", "Running"), svc("BITS", "Servicio de transferencia inteligente en segundo plano (BITS)", "Stopped"),
        svc("Dhcp", "Cliente DHCP", "Running"), svc("Dnscache", "Cliente DNS", "Running"), svc("EventLog", "Registro de eventos de Windows", "Running"),
        svc("LanmanWorkstation", "Estación de trabajo", "Running"), svc("Netman", "Conexiones de red", "Stopped"), svc("NetworkSetupSvc", "Servicio de configuración de red", "Stopped"),
        svc("NlaSvc", "Reconocimiento de ubicación de red", "Running"), svc("Spooler", "Cola de impresión", "Running"), svc("W32Time", "Hora de Windows", "Stopped"),
        svc("WinDefend", "Servicio antivirus de Microsoft Defender", "Running"), svc("Winmgmt", "Instrumental de administración de Windows", "Running"), svc("wuauserv", "Windows Update", "Stopped")
      ],
      procs: [
        proc("svchost", 1148, 421, 21, 2864, 12088, 3.41), proc("explorer", 4212, 2310, 83, 62100, 112420, 21.88), proc("chrome", 8120, 1420, 45, 168400, 231100, 35.2), proc("chrome", 8344, 520, 18, 41200, 69800, 4.17),
        proc("MicrosoftEdgeUpdate", 5128, 134, 11, 1112, 3700, 0.05), proc("Microsoft.Photos", 6032, 650, 39, 31800, 40200, 1.02), proc("powershell", 7104, 612, 31, 91200, 106400, 1.64),
        proc("System", 4, 4120, 0, 52, 7208, 12.09), proc("Code", 9264, 1830, 62, 178300, 214200, 58.31), proc("csrss", 708, 782, 25, 1760, 5124, 6.88), proc("winlogon", 784, 244, 14, 2484, 8936, 0.33), proc("Spotify", 9610, 940, 28, 52200, 76340, 9.14)
      ]
    };
    function proc(n, id, handles, npm, pm, ws, cpu) { return { name: n, id: id, npm: npm, pm: pm, ws: ws, handles: handles, cpu: cpu, si: id === 4 ? 0 : 1 }; }
  };

  /* ---------------------------------------------------------- rutas */
  function toInt(p, cwd) { // ruta de Windows -> ruta interna (posix) respecto a cwd interna
    var s = String(p).replace(/\\/g, "/");
    var m = /^([A-Za-z]):(.*)$/.exec(s);
    if (m) { if (m[1].toUpperCase() !== "C") return { err: "drive", drive: m[1] }; s = m[2] || "/"; if (s.charAt(0) !== "/") s = cwd + "/" + s; }
    if (s.charAt(0) === "~") s = "/Users/alumno" + s.slice(1);
    return { p: s };
  }
  function toWin(abs) { return "C:" + (abs === "/" ? "\\" : abs.replace(/\//g, "\\")); }
  Sim.toWin = toWin; Sim.psToInt = toInt;

  /* ---------------------------------------------------------- formato de salida */
  function fmtNum(n) { return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ","); }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function fmtDT(ms) { var d = new Date(ms); return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear() + "     " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function str(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "True" : "False";
    if (typeof v === "number") return fmtNum(v);
    if (Array.isArray(v)) return v.map(str).join(" ");
    if (isObj(v)) {
      if (v.__t === "Match") return v.path ? v.path + ":" + v.n + ":" + v.line : v.line;
      if (v.__t === "File" || v.__t === "Dir") return v.Name;
      if (v.__t === "Service") return v.Name;
      if (v.__t === "Process") return "System.Diagnostics.Process (" + v.ProcessName + ")";
      return "@{" + Object.keys(v).filter(function (k) { return k !== "__t"; }).map(function (k) { return k + "=" + str(v[k]); }).join("; ") + "}";
    }
    return String(v);
  }
  function getProp(o, name) {
    if (o === null || o === undefined) return undefined;
    if (Array.isArray(o)) { if (/^(count|length)$/i.test(name)) return o.length; return o.map(function (x) { return getProp(x, name); }); }
    if (typeof o === "string") { if (/^length$/i.test(name)) return o.length; return undefined; }
    if (typeof o !== "object") return undefined;
    var l = name.toLowerCase();
    for (var k in o) if (k !== "__t" && k.toLowerCase() === l) return o[k];
    return undefined;
  }
  function hasProp(o, name) { if (!isObj(o)) return false; var l = name.toLowerCase(); for (var k in o) if (k !== "__t" && k.toLowerCase() === l) return true; return false; }
  function propKey(o, name) { var l = name.toLowerCase(); for (var k in o) if (k !== "__t" && k.toLowerCase() === l) return k; return name; }

  function table(rows, cols, opts) { // cols: [{h, k|fn, right}]
    opts = opts || {};
    var data = rows.map(function (r) { return cols.map(function (c) { return c.fn ? c.fn(r) : str(getProp(r, c.k)); }); });
    var w = cols.map(function (c, i) { return Math.max(c.h.length, Math.max.apply(null, data.map(function (d) { return d[i].length; }).concat([0]))); });
    var line = function (cells, hdr) { return cells.map(function (t, i) { var last = i === cols.length - 1; var rt = cols[i].right && !hdr; var rh = cols[i].right; var s = (rt || (hdr && rh)) ? t.padStart(w[i]) : (last ? t : t.padEnd(w[i])); return s; }).join(" ").replace(/\s+$/, ""); };
    var out = ["", line(cols.map(function (c) { return c.h; }), true), line(cols.map(function (c) { return "-".repeat(c.h.length); }), true)];
    out[2] = cols.map(function (c, i) { var dd = "-".repeat(c.h.length); return c.right ? dd.padStart(w[i]) : (i === cols.length - 1 ? dd : dd.padEnd(w[i])); }).join(" ").replace(/\s+$/, "");
    data.forEach(function (d) { out.push(line(d, false)); });
    out.push("");
    return out.join("\n") + "\n";
  }
  function list(objs, props) {
    var out = "";
    objs.forEach(function (o) {
      var ps = props || Object.keys(o).filter(function (k) { return k !== "__t"; });
      var w = Math.max.apply(null, ps.map(function (p) { return p.length; }));
      out += "\n" + ps.map(function (p) { var val = getProp(o, p); return p.padEnd(w) + " : " + (Array.isArray(val) ? "{" + val.map(str).join(", ") + "}" : str(val)); }).join("\n") + "\n";
    });
    return out + "\n";
  }

  /* Formatea una lista de valores como lo haria Out-Default */
  function formatOut(vals, st) {
    var out = "", i = 0;
    while (i < vals.length) {
      var v = vals[i];
      if (isObj(v)) {
        var t = v.__t, j = i;
        while (j < vals.length && isObj(vals[j]) && vals[j].__t === t && (t !== "Obj" || sameShape(vals[j], v))) j++;
        out += formatGroup(vals.slice(i, j), t);
        i = j; continue;
      }
      if (Array.isArray(v)) { out += v.map(str).join("\n") + "\n"; i++; continue; }
      out += str(v) + "\n"; i++;
    }
    return out;
  }
  function sameShape(a, b) { return Object.keys(a).join() === Object.keys(b).join(); }
  function formatGroup(objs, t) {
    if (t === "File" || t === "Dir") {
      var groups = [], cur = null;
      objs.forEach(function (o) { if (!cur || cur.dir !== o.Dir) { cur = { dir: o.Dir, items: [] }; groups.push(cur); } cur.items.push(o); });
      return groups.map(function (gr) {
        var s = "\n\n    Directorio: " + gr.dir + "\n\n\n";
        s += "Mode".padEnd(21) + "LastWriteTime" + "Length".padStart(15) + " Name\n" + "----".padEnd(21) + "-------------" + "------".padStart(15) + " ----\n";
        gr.items.forEach(function (o) { s += o.Mode.padEnd(14) + fmtDT(o.LastWriteTime) + (o.__t === "Dir" ? "" : String(o.Length)).padStart(15) + " " + o.Name + "\n"; });
        return s;
      }).join("");
    }
    if (t === "Service") {
      var w = Math.max(4, Math.max.apply(null, objs.map(function (o) { return o.Name.length; })));
      return "\nStatus   " + "Name".padEnd(w) + " DisplayName\n------   " + "----".padEnd(w) + " -----------\n" + objs.map(function (o) { return o.Status.padEnd(8) + " " + o.Name.padEnd(w) + " " + o.DisplayName; }).join("\n") + "\n\n";
    }
    if (t === "Process") {
      var s2 = "\nHandles  NPM(K)    PM(K)      WS(K)     CPU(s)     Id  SI ProcessName\n-------  ------    -----      -----     ------     --  -- -----------\n";
      objs.forEach(function (o) { s2 += String(o.Handles).padStart(7) + " " + String(o.NPM).padStart(7) + " " + String(o.PM).padStart(8) + " " + String(o.WS).padStart(10) + " " + (o.CPU === null ? "" : fmtNum(o.CPU)).padStart(10) + " " + String(o.Id).padStart(6) + " " + String(o.SI).padStart(3) + " " + o.ProcessName + "\n"; });
      return s2 + "\n";
    }
    if (t === "Match") return objs.map(function (m) { return str(m); }).join("\n") + "\n";
    if (t === "List") return list(objs, objs[0].__props);
    if (t === "Drive") return table(objs, [{ h: "Name", k: "Name" }, { h: "Used (GB)", k: "Used", right: true }, { h: "Free (GB)", k: "Free", right: true }, { h: "Provider", k: "Provider" }, { h: "Root", k: "Root" }, { h: "CurrentLocation", k: "Cur" }]);
    if (t === "Hotfix") return table(objs, [{ h: "Source", k: "Source" }, { h: "Description", k: "Description" }, { h: "HotFixID", k: "HotFixID" }, { h: "InstalledBy", k: "InstalledBy" }, { h: "InstalledOn", k: "InstalledOn" }]);
    if (t === "Measure") {
      return objs.map(function (o) { return o.__list ? list([o]) : table([o], [{ h: "Lines", k: "Lines", right: true }, { h: "Words", k: "Words", right: true }, { h: "Characters", k: "Characters", right: true }, { h: "Property", k: "Property" }].filter(function (c) { return hasProp(o, c.k); })); }).join("");
    }
    // objetos genericos (Select-Object)
    var keys = Object.keys(objs[0]).filter(function (k) { return k !== "__t"; });
    if (keys.length > 4) return list(objs);
    return table(objs, keys.map(function (k) { var numeric = typeof objs[0][k] === "number"; return { h: k, k: k, right: numeric }; }));
  }
  Sim.psFormat = formatOut;

  /* ---------------------------------------------------------- tokenizador */
  function tokenize(src) {
    var toks = [], i = 0, n = src.length;
    function prevAdj() { return toks.length && toks[toks.length - 1].end === i; }
    function push(t, start) { t.end = i; t.start = start; toks.push(t); }
    while (i < n) {
      var c = src.charAt(i), st = i;
      if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
      if (c === "#") { while (i < n && src.charAt(i) !== "\n") i++; continue; }
      if (c === "'") {
        var s = ""; i++;
        while (i < n) { if (src.charAt(i) === "'") { if (src.charAt(i + 1) === "'") { s += "'"; i += 2; continue; } break; } s += src.charAt(i++); }
        if (i >= n) return { err: "Falta el terminador: '." }; i++;
        push({ t: "str", v: s }, st); continue;
      }
      if (c === '"') {
        var parts = [], buf = ""; i++;
        while (i < n && src.charAt(i) !== '"') {
          var d = src.charAt(i);
          if (d === "`" && i + 1 < n) { var e = src.charAt(i + 1); buf += ({ n: "\n", t: "\t", r: "", "0": "\0" })[e] !== undefined ? ({ n: "\n", t: "\t", r: "", "0": "\0" })[e] : e; i += 2; continue; }
          if (d === '"' ) break;
          if (d === "$") {
            var m = /^\$(\{([^}]+)\}|(env:)?(\w+|\?|_))/.exec(src.slice(i));
            if (src.charAt(i + 1) === "(") {
              var depth = 0, j = i + 1; for (; j < n; j++) { if (src.charAt(j) === "(") depth++; else if (src.charAt(j) === ")") { depth--; if (depth === 0) break; } }
              if (buf) parts.push({ lit: buf }); buf = ""; parts.push({ sub: src.slice(i + 2, j) }); i = j + 1; continue;
            }
            if (m) { if (buf) parts.push({ lit: buf }); buf = ""; parts.push({ v: m[2] || ((m[3] || "") + m[4]) }); i += m[0].length; continue; }
          }
          if (d === '"' && src.charAt(i + 1) === '"') { buf += '"'; i += 2; continue; }
          buf += d; i++;
        }
        if (i >= n) return { err: 'Falta el terminador: ".' }; i++;
        if (buf || !parts.length) parts.push({ lit: buf });
        push({ t: "dstr", parts: parts }, st); continue;
      }
      if (c === "$") {
        if (src.charAt(i + 1) === "(") { push({ t: "op", v: "$(" }, st); i += 2; toks[toks.length - 1].end = i; continue; }
        var vm = /^\$(\{([^}]+)\}|((?:env:|global:|script:)?(?:\w+|\?)))/.exec(src.slice(i));
        if (vm) { i += vm[0].length; push({ t: "var", name: vm[2] || vm[3] }, st); continue; }
      }
      if (c === "@" && src.charAt(i + 1) === "(") { i += 2; push({ t: "op", v: "@(" }, st); continue; }
      if ("|;,(){}=!".indexOf(c) >= 0 && !(c === "=" && src.charAt(i + 1) === "=") ) {
        if (c === "!" ) { i++; push({ t: "op", v: "!" }, st); continue; }
        i++; push({ t: "op", v: c }, st); continue;
      }
      if (c === ">") { var op = src.charAt(i + 1) === ">" ? ">>" : ">"; i += op.length; push({ t: "op", v: op }, st); continue; }
      if (c === "." && prevAdj() && /[A-Za-z_]/.test(src.charAt(i + 1)) && /^(var|member|call)$|^op$/.test(toks[toks.length - 1].t) && (toks[toks.length - 1].t !== "op" || toks[toks.length - 1].v === ")")) {
        i++; var mm = /^\w+/.exec(src.slice(i))[0]; i += mm.length;
        if (src.charAt(i) === "(") { push({ t: "member", name: mm, call: true }, st); } else push({ t: "member", name: mm }, st);
        continue;
      }
      if (c === "-" && /[A-Za-z]/.test(src.charAt(i + 1))) {
        var pm = /^-[A-Za-z]\w*/.exec(src.slice(i))[0]; i += pm.length;
        if (src.charAt(i) === ":") { i++; }
        push({ t: "param", v: pm.slice(1) }, st); continue;
      }
      // palabra suelta
      var w = "";
      while (i < n && " \t\r\n|;,(){}'\"".indexOf(src.charAt(i)) < 0 && src.charAt(i) !== ">" ) w += src.charAt(i++);
      if (!w) { i++; continue; }
      if (/^-?\d+(\.\d+)?$/.test(w)) push({ t: "num", v: parseFloat(w), raw: w }, st); else push({ t: "word", v: w }, st);
    }
    return { toks: toks };
  }

  /* ---------------------------------------------------------- shell */
  function PSShell(st) { this.st = st; this.fs = new VFS(st.fs, true); this.host = []; this.errs = []; }
  Sim.PSShell = PSShell;
  var PP = PSShell.prototype;

  PP.promptInfo = function () { var p = toWin(this.st.cwd); return { path: p, text: "PS " + p + "> " }; };

  var CMDLETS = {}, ALIASES = {};
  Sim.PS_CMDLETS = CMDLETS;
  function def(name, spec, fn) { spec.fn = fn; spec.name = name; CMDLETS[name.toLowerCase()] = spec; (spec.aliases || []).forEach(function (a) { ALIASES[a.toLowerCase()] = name; }); }
  var COMMON = { ErrorAction: { alias: ["EA"] }, Verbose: { sw: 1 }, Debug: { sw: 1 }, WhatIf: { sw: 1 }, Confirm: { sw: 1 }, WarningAction: {}, OutVariable: {} };

  var NATIVE = { tree: 1, systeminfo: 1, hostname: 1, whoami: 1, notepad: 1, ipconfig: 1, ver: 1, calc: 1, cmd: 1 };

  PP.find = function (name) {
    var l = name.toLowerCase();
    if (ALIASES[l]) return CMDLETS[ALIASES[l].toLowerCase()];
    if (CMDLETS[l]) return CMDLETS[l];
    if (CMDLETS[l + ".exe"]) return CMDLETS[l + ".exe"];
    if (NATIVE[l.replace(/\.exe$/, "")]) return CMDLETS["native:" + l.replace(/\.exe$/, "")];
    return null;
  };

  /* ---- parser ---- */
  function Parser(toks) { this.t = toks; this.i = 0; }
  var PR = Parser.prototype;
  PR.peek = function (o) { return this.t[this.i + (o || 0)]; };
  PR.next = function () { return this.t[this.i++]; };
  PR.isOp = function (v, o) { var k = this.peek(o); return k && k.t === "op" && k.v === v; };

  PR.statements = function (stop) { // hasta ')' '}' o fin
    var out = [];
    while (this.i < this.t.length) {
      if (stop && this.peek().t === "op" && this.peek().v === stop) break;
      if (this.isOp(";")) { this.i++; continue; }
      out.push(this.pipeline(stop));
    }
    return out;
  };
  PR.pipeline = function (stop) {
    var els = [this.element(stop)];
    while (this.isOp("|")) { this.i++; els.push(this.element(stop)); }
    var redir = null;
    if (this.peek() && this.peek().t === "op" && (this.peek().v === ">" || this.peek().v === ">>")) { var op = this.next().v; redir = { op: op, target: this.argValue() }; }
    var tk = this.peek();
    if (tk && !(tk.t === "op" && (tk.v === ";" || tk.v === ")" || tk.v === "}"))) throw { msg: "Token inesperado '" + (tk.v !== undefined ? tk.v : tk.name || "") + "' en la expresión o la instrucción." };
    return { els: els, redir: redir };
  };
  PR.startsCommand = function () {
    var k = this.peek();
    return k && k.t === "word" && !/^[\.\\\/]/.test(k.v) && !/^\d/.test(k.v);
  };
  PR.element = function (stop) {
    var k = this.peek();
    if (!k) throw { msg: "Falta un elemento de la canalización." };
    if (k.t === "var" && this.isOp("=", 1)) { this.i += 2; var rhs = this.pipeline(stop); return { kind: "assign", name: k.name, value: rhs }; }
    if (k.t === "word" || (k.t === "op" && k.v === "&")) return this.command(stop);
    var e = this.expr();
    return { kind: "expr", expr: e };
  };
  PR.command = function (stop) {
    var name = this.next().v, args = [];
    while (this.i < this.t.length) {
      var k = this.peek();
      if (k.t === "op" && (k.v === "|" || k.v === ";" || k.v === ">" || k.v === ">>" || k.v === ")" || k.v === "}")) break;
      if (k.t === "param") { this.i++; args.push({ p: k.v }); continue; }
      args.push({ v: this.argList() });
    }
    return { kind: "cmd", name: name, args: args };
  };
  PR.argList = function () {
    var first = this.argValue();
    if (this.isOp(",")) {
      var items = [first];
      while (this.isOp(",")) { this.i++; items.push(this.argValue()); }
      return { k: "arr", items: items };
    }
    return first;
  };
  PR.argValue = function () {
    var k = this.peek();
    if (!k) throw { msg: "Falta un argumento." };
    return this.postfix(this.primary(true));
  };
  PR.primary = function (argMode) {
    var k = this.next();
    if (!k) throw { msg: "Falta una expresión." };
    switch (k.t) {
      case "str": return { k: "lit", v: k.v };
      case "dstr": return { k: "str", parts: k.parts };
      case "num": return { k: "lit", v: k.v, raw: k.raw };
      case "var": return { k: "var", name: k.name };
      case "word": return { k: "lit", v: k.v, bare: true };
      case "op":
        if (k.v === "(") { var inner = this.subStatements(")"); return { k: "sub", stmts: inner }; }
        if (k.v === "$(") { var inner2 = this.subStatements(")"); return { k: "sub", stmts: inner2 }; }
        if (k.v === "@(") { var inner3 = this.subStatements(")"); return { k: "sub", stmts: inner3, arr: true }; }
        if (k.v === "{") { var start = this.i, depth = 1; while (this.i < this.t.length && depth) { var q = this.t[this.i++]; if (q.t === "op" && q.v === "{") depth++; else if (q.t === "op" && q.v === "}") depth--; } if (depth) throw { msg: "Falta la llave de cierre '}'." }; return { k: "block", toks: this.t.slice(start, this.i - 1) }; }
        if (k.v === "!" ) return { k: "not", e: this.postfix(this.primary()) };
    }
    throw { msg: "Token inesperado '" + (k.v !== undefined ? k.v : k.name) + "' en la expresión o la instrucción." };
  };
  PR.subStatements = function (close) {
    var stmts = this.statements(close);
    if (!this.isOp(close)) throw { msg: "Falta el paréntesis de cierre ')'." };
    this.i++; return stmts;
  };
  PR.postfix = function (e) {
    for (;;) {
      var k = this.peek();
      if (k && k.t === "member" && this.t[this.i].start === this.t[this.i - 1].end) {
        this.i++;
        if (k.call) { this.i++; var args = []; if (!this.isOp(")")) { args.push(this.expr()); while (this.isOp(",")) { this.i++; args.push(this.expr()); } } this.i++; e = { k: "call", obj: e, name: k.name, args: args }; }
        else e = { k: "member", obj: e, name: k.name };
        continue;
      }
      break;
    }
    return e;
  };
  /* expresiones con operadores (dentro de ( ) y { }) */
  var CMPOPS = ["eq", "ne", "gt", "ge", "lt", "le", "like", "notlike", "match", "notmatch", "contains", "notcontains", "ceq", "cne", "ieq", "ine", "in", "notin", "is", "isnot"];
  PR.expr = function () { return this.orE(); };
  PR.orE = function () { var l = this.andE(); while (this.peek() && this.peek().t === "param" && /^(or|xor)$/i.test(this.peek().v)) { var o = this.next().v.toLowerCase(); l = { k: "bin", op: o, l: l, r: this.andE() }; } return l; };
  PR.andE = function () { var l = this.notE(); while (this.peek() && this.peek().t === "param" && /^and$/i.test(this.peek().v)) { this.i++; l = { k: "bin", op: "and", l: l, r: this.notE() }; } return l; };
  PR.notE = function () { var k = this.peek(); if (k && ((k.t === "param" && /^not$/i.test(k.v)) || (k.t === "op" && k.v === "!"))) { this.i++; return { k: "not", e: this.notE() }; } return this.cmpE(); };
  PR.cmpE = function () {
    var l = this.postfix(this.primary());
    var k = this.peek();
    while (k && k.t === "param" && CMPOPS.indexOf(k.v.toLowerCase()) >= 0) { this.i++; var r = this.postfix(this.primary()); l = { k: "bin", op: k.v.toLowerCase(), l: l, r: r }; k = this.peek(); }
    if (this.isOp(",")) { var items = [l]; while (this.isOp(",")) { this.i++; items.push(this.postfix(this.primary())); } return { k: "arr", items: items }; }
    return l;
  };

  /* ---- evaluacion ---- */
  function truthy(v) { if (Array.isArray(v)) return v.length > 0; if (typeof v === "string") return v.length > 0; return !!v; }
  function wild(p, s) { return VFS.globToRegex(p.replace(/\\(?![*?\[])/g, "\\\\"), true).test(s); }
  function psEq(a, b) { if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b); return str(a).toLowerCase() === str(b).toLowerCase(); }
  function cmpVals(a, b) { if (typeof a === "number" || typeof b === "number" || (/^-?\d+(\.\d+)?$/.test(str(a)) && /^-?\d+(\.\d+)?$/.test(str(b)))) return Number(a) - Number(b); return str(a).toLowerCase().localeCompare(str(b).toLowerCase(), "es"); }

  PP.evalExpr = function (n, scope) {
    var self = this;
    switch (n.k) {
      case "lit": return n.v;
      case "str": return n.parts.map(function (p) { if (p.lit !== undefined) return p.lit; if (p.sub !== undefined) { return self.evalSrc(p.sub, scope).map(str).join(" "); } return str(self.getVar(p.v, scope)); }).join("");
      case "var": return this.getVar(n.name, scope);
      case "member": { var o = this.evalExpr(n.obj, scope); return getProp(o, n.name); }
      case "call": {
        var obj = this.evalExpr(n.obj, scope), a = n.args.map(function (x) { return self.evalExpr(x, scope); }), s = str(obj), nm = n.name.toLowerCase();
        if (nm === "tostring") return s; if (nm === "toupper") return s.toUpperCase(); if (nm === "tolower") return s.toLowerCase(); if (nm === "trim") return s.trim();
        if (nm === "contains") return s.indexOf(str(a[0])) >= 0; if (nm === "startswith") return s.toLowerCase().indexOf(str(a[0]).toLowerCase()) === 0; if (nm === "endswith") return s.toLowerCase().slice(-str(a[0]).length) === str(a[0]).toLowerCase();
        if (nm === "replace") return s.split(str(a[0])).join(str(a[1])); if (nm === "split") return s.split(str(a[0])); if (nm === "substring") return s.substr(+a[0], a[1] === undefined ? undefined : +a[1]);
        throw { msg: "No se encuentra un método con el nombre '" + n.name + "'." };
      }
      case "arr": return n.items.map(function (x) { return self.evalExpr(x, scope); });
      case "not": return !truthy(this.evalExpr(n.e, scope));
      case "sub": { var vals = this.runStatements(n.stmts, scope, true); return n.arr ? vals : (vals.length === 1 ? vals[0] : vals.length === 0 ? null : vals); }
      case "block": return { __block: true, toks: n.toks };
      case "bin": {
        if (n.op === "and") return truthy(this.evalExpr(n.l, scope)) && truthy(this.evalExpr(n.r, scope));
        if (n.op === "or") return truthy(this.evalExpr(n.l, scope)) || truthy(this.evalExpr(n.r, scope));
        if (n.op === "xor") return truthy(this.evalExpr(n.l, scope)) !== truthy(this.evalExpr(n.r, scope));
        var l = this.evalExpr(n.l, scope), r = this.evalExpr(n.r, scope);
        if (Array.isArray(l) && !/^(contains|notcontains|in|notin)$/.test(n.op)) return l.filter(function (x) { return compareOp(n.op, x, r); });
        return compareOp(n.op, l, r);
      }
    }
    throw { msg: "Expresión no admitida." };
  };
  function compareOp(op, a, b) {
    switch (op) {
      case "eq": case "ceq": case "ieq": return psEq(a, b);
      case "ne": case "cne": case "ine": return !psEq(a, b);
      case "gt": return cmpVals(a, b) > 0; case "ge": return cmpVals(a, b) >= 0; case "lt": return cmpVals(a, b) < 0; case "le": return cmpVals(a, b) <= 0;
      case "like": return wild(str(b), str(a)); case "notlike": return !wild(str(b), str(a));
      case "match": try { return new RegExp(str(b), "i").test(str(a)); } catch (e) { return false; }
      case "notmatch": try { return !new RegExp(str(b), "i").test(str(a)); } catch (e) { return true; }
      case "contains": return (Array.isArray(a) ? a : [a]).some(function (x) { return psEq(x, b); });
      case "notcontains": return !(Array.isArray(a) ? a : [a]).some(function (x) { return psEq(x, b); });
      case "in": return (Array.isArray(b) ? b : [b]).some(function (x) { return psEq(x, a); });
      case "notin": return !(Array.isArray(b) ? b : [b]).some(function (x) { return psEq(x, a); });
    }
    return false;
  }
  PP.getVar = function (name, scope) {
    var l = name.toLowerCase();
    if (l === "_" || l === "psitem") return scope.cur;
    if (l === "true") return true; if (l === "false") return false; if (l === "null") return null;
    if (l === "pwd") return { __t: "Path", toString: toWin(this.st.cwd) };
    if (l === "home") return "C:\\Users\\alumno";
    if (l === "?") return true;
    var em = /^env:(.+)$/i.exec(name);
    if (em) { var E = { computername: "DESKTOP-4K2A9LB", username: "alumno", userprofile: "C:\\Users\\alumno", os: "Windows_NT", systemroot: "C:\\Windows" }; return E[em[1].toLowerCase()] || ""; }
    if (Object.prototype.hasOwnProperty.call(this.st.vars, l)) return this.st.vars[l];
    return null;
  };
  PP.evalSrc = function (src, scope) { var tk = tokenize(src); if (tk.err) throw { msg: tk.err }; var p = new Parser(tk.toks); return this.runStatements(p.statements(), scope, true); };

  /* ejecuta un script block con $_ = item; devuelve valor */
  PP.callBlock = function (blk, item, scope, asPipeline) {
    var p = new Parser(blk.toks), sc = { cur: item };
    var k = p.peek();
    if (k && (k.t === "var" || k.t === "param" || k.t === "str" || k.t === "dstr" || k.t === "num" || (k.t === "op" && (k.v === "(" || k.v === "!"))) && !asPipeline) {
      var e = p.expr(); return this.evalExpr(e, sc);
    }
    var vals = this.runStatements(p.statements(), sc, true);
    return asPipeline ? vals : (vals.length === 1 ? vals[0] : vals);
  };

  /* ---- ejecucion de pipelines ---- */
  PP.runStatements = function (stmts, scope, capture) {
    var self = this, all = [];
    stmts.forEach(function (pl) {
      var out = self.runPipeline(pl, scope);
      if (capture) { all = all.concat(out); return; }
      self.flush(out);
    });
    return all;
  };
  PP.flush = function (vals) { var t = formatOut(vals, this.st); if (t) this.host.push({ e: false, s: t }); };
  PP.err = function (msg) { this.host.push({ e: true, s: msg + "\n" }); };

  PP.runPipeline = function (pl, scope) {
    var data = null, self = this;
    var out = [];
    for (var i = 0; i < pl.els.length; i++) {
      var el = pl.els[i];
      if (el.kind === "expr") { var v = this.evalExpr(el.expr, scope); data = Array.isArray(v) ? v : (v === null ? [] : [v]); continue; }
      if (el.kind === "assign") { var r = this.runPipeline(el.value, scope); this.st.vars[el.name.toLowerCase()] = r.length === 1 ? r[0] : r; data = []; continue; }
      data = this.runCmd(el, data, scope);
      if (data === null) data = [];
    }
    out = data || [];
    if (pl.redir) {
      var target = this.evalExpr(pl.redir.target, scope), text = formatOut(out, this.st);
      this.writeOut(str(target), text, pl.redir.op === ">>");
      return [];
    }
    return out;
  };

  PP.winPath = function (p) {
    var r = toInt(p, this.st.cwd);
    if (r.err) { var e = new Error("drive"); e.ps = "No se encuentra la unidad. No existe ninguna unidad con el nombre '" + r.drive + "'."; throw e; }
    return r.p;
  };
  PP.writeOut = function (path, text, append) {
    var ip; try { ip = this.winPath(path); } catch (e) { this.err("Out-File : " + e.ps); return; }
    var res = this.fs.resolve(ip, this.st.cwd);
    if (res.id === null && res.parent === undefined) { this.err("Out-File : No se encuentra una parte de la ruta de acceso '" + toWin(res.abs || ip) + "'."); return; }
    if (res.id !== null && this.fs.node(res.id).type === "d") { this.err("Out-File : Acceso denegado a la ruta de acceso '" + toWin(res.abs) + "'."); return; }
    this.fs.writeFile(ip, this.st.cwd, text, append);
  };

  PP.runCmd = function (el, input, scope) {
    var spec = this.find(el.name), self = this;
    if (!spec) {
      this.err(el.name + " : El término '" + el.name + "' no se reconoce como nombre de un cmdlet, función, archivo de script o programa ejecutable. Compruebe si escribió correctamente el nombre o, si incluyó una ruta de acceso, compruebe que dicha ruta es correcta e inténtelo de nuevo.");
      return [];
    }
    // evaluar argumentos
    var items = [];
    el.args.forEach(function (a) {
      if (a.p !== undefined) items.push({ p: a.p });
      else {
        var v = self.evalExpr(a.v, scope);
        // palabras sueltas numericas se mantienen como numero; las rutas bare se quedan como string
        items.push({ v: v, bare: a.v.k === "lit" && a.v.bare });
      }
    });
    var P;
    try { P = this.bind(spec, items); } catch (e) { if (e.psb) { this.err(spec.name + " : " + e.psb); return []; } throw e; }
    var ctx = { sh: this, P: P, input: input, scope: scope, name: spec.name };
    try {
      var res = spec.fn.call(this, ctx);
      return res || [];
    } catch (e) {
      if (e && e.ps) { this.err((e.cmd || spec.name) + " : " + e.ps); return []; }
      if (e && e.msg) { this.err(spec.name + " : " + e.msg); return []; }
      throw e;
    }
  };

  PP.bind = function (spec, items) {
    var params = {}, order = [], names = Object.keys(spec.params || {});
    var all = {}; names.forEach(function (n) { all[n] = spec.params[n]; });
    Object.keys(COMMON).forEach(function (n) { if (!all[n]) all[n] = COMMON[n]; });
    var lookup = {};
    Object.keys(all).forEach(function (n) { lookup[n.toLowerCase()] = n; (all[n].alias || []).forEach(function (a) { lookup[a.toLowerCase()] = n; }); });
    function match(p) {
      var l = p.toLowerCase();
      if (lookup[l]) return lookup[l];
      var cands = Object.keys(lookup).filter(function (k) { return k.indexOf(l) === 0; }).map(function (k) { return lookup[k]; });
      cands = cands.filter(function (x, i) { return cands.indexOf(x) === i; });
      if (cands.length === 1) return cands[0];
      if (cands.length > 1) throw { psb: "No se puede procesar el parámetro porque el nombre de parámetro '" + p + "' es ambiguo. Coincidencias: " + cands.map(function (c) { return "-" + c; }).join(", ") + "." };
      throw { psb: "No se encuentra ningún parámetro que coincida con el nombre de parámetro '" + p + "'." };
    }
    var posList = names.filter(function (n) { return spec.params[n].pos !== undefined; }).sort(function (a, b) { return spec.params[a].pos - spec.params[b].pos; });
    var P = { rest: [] }, pos = [], i;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.p !== undefined) {
        var nm = match(it.p), pd = all[nm];
        if (pd.sw) { var nx = items[i + 1]; if (nx && nx.v !== undefined && (nx.v === true || nx.v === false) && !nx.bare) { P[nm] = nx.v; i++; } else P[nm] = true; }
        else { var nv = items[i + 1]; if (!nv || nv.p !== undefined) throw { psb: "Falta un argumento para el parámetro '" + nm + "'. Especifique un parámetro de tipo '" + (pd.arr ? "System.String[]" : "System.String") + "' e inténtelo de nuevo." }; P[nm] = nv.v; i++; }
        P["_set_" + nm] = true;
      } else pos.push(it);
    }
    var pi = 0;
    pos.forEach(function (it) {
      while (pi < posList.length && P["_set_" + posList[pi]]) pi++;
      if (pi < posList.length) { P[posList[pi]] = it.v; P["_set_" + posList[pi]] = true; pi++; }
      else if (spec.rest) P.rest.push(it.v);
      else throw { psb: "No se encuentra ningún parámetro posicional que acepte el argumento '" + str(it.v) + "'." };
    });
    return P;
  };

  PP.run = function (line) {
    this.host = [];
    var res = { text: [], clear: false, status: 0 };
    if (line.trim()) this.st.hist.push(line);
    var tk = tokenize(line);
    if (tk.err) { res.text.push({ e: true, s: tk.err + "\n" }); return res; }
    try {
      var p = new Parser(tk.toks), stmts = p.statements();
      var scope = { cur: null };
      for (var i = 0; i < stmts.length; i++) this.flush(this.runPipeline(stmts[i], scope));
    } catch (e) {
      if (e && e.msg) this.err("En línea: 1\n" + e.msg); else if (e && e.ps) this.err(e.ps); else throw e;
    }
    res.text = this.host; res.clear = !!this.clearFlag; this.clearFlag = false;
    return res;
  };
  PP.exec = function (line) { return this.run(line); };

  /* ---------------------------------------------------------- helpers de cmdlets */
  function arr(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }
  function pathErr(sh, p, cmd) { var e = new Error("path"); e.ps = "No se encuentra la ruta de acceso '" + toWin(typeof p === "string" ? p : p) + "' porque no existe."; e.cmd = cmd; return e; }
  function fileObj(sh, n, name, dirAbs) {
    var isD = n.type === "d";
    return { __t: isD ? "Dir" : "File", Mode: (isD ? "d" : "-") + (n.ro ? "ar" : "a") + "----".slice(isD ? 0 : 0), Name: name, Length: isD ? undefined : sh.fs.size(n), LastWriteTime: n.m, Dir: toWin(dirAbs), FullName: toWin((dirAbs === "/" ? "" : dirAbs) + "/" + name), BaseName: name.replace(/\.[^.]*$/, ""), Extension: (/\.[^.]*$/.exec(name) || [""])[0], PSIsContainer: isD, Attributes: isD ? "Directory" : "Archive" };
  }
  function fixMode(o) { if (o.__t === "Dir") o.Mode = "d-----"; else o.Mode = "-a----"; return o; }
  function mkFile(sh, n, name, dirAbs) { return fixMode(fileObj(sh, n, name, dirAbs)); }

  /* resuelve una ruta (con comodines). Devuelve [{abs, name, node}] */
  PP.expandPath = function (p, cmd, allowMissing) {
    var self = this, s = str(p);
    var ip = this.winPath(s);
    if (VFS.hasGlob(ip.replace(/^\/+/, "/"))) {
      var m = this.fs.glob(ip, this.st.cwd);
      return m.map(function (x) { var r = self.fs.resolve(x.charAt(0) === "/" ? x : self.st.cwd + "/" + x, "/"); return { abs: r.abs, name: r.name, node: self.fs.node(r.id), parent: r.parent }; });
    }
    var r = this.fs.resolve(ip, this.st.cwd);
    if (r.id === null) {
      if (allowMissing) return [{ abs: r.abs, name: r.name, node: null, missing: true, parent: r.parent, ip: ip, err: r.err }];
      var e = new Error("path"); e.ps = "No se encuentra la ruta de acceso '" + toWin(r.abs || self.fs.resolve(ip, self.st.cwd).abs || ip) + "' porque no existe."; e.cmd = cmd; throw e;
    }
    return [{ abs: r.abs, name: r.name || "", node: this.fs.node(r.id), parent: r.parent }];
  };
  function listDirObjs(sh, ent, o) {
    var out = [];
    function visit(e, recurse, top) {
      var n = e.node;
      if (n.type === "d") {
        var names = Object.keys(n.entries).sort(VFS.cmpName);
        names.forEach(function (nm) {
          var ch = sh.fs.node(n.entries[nm]), obj = mkFile(sh, ch, nm, e.abs);
          if (o.File && ch.type === "d") { /* omitir */ }
          else if (o.Directory && ch.type !== "d") { /* omitir */ }
          else if (o.Filter && !wild(o.Filter, nm)) { /* omitir */ }
          else if (o.Include && !arr(o.Include).some(function (p) { return wild(str(p), nm); })) { /* omitir */ }
          else if (o.Exclude && arr(o.Exclude).some(function (p) { return wild(str(p), nm); })) { /* omitir */ }
          else out.push(obj);
          if (recurse && ch.type === "d") visit({ abs: (e.abs === "/" ? "" : e.abs) + "/" + nm, node: ch }, true);
        });
      }
    }
    visit(ent, !!o.Recurse, true);
    return out;
  }

  /* ---------------------------------------------------------- cmdlets */
  def("Get-ChildItem", { aliases: ["ls", "dir", "gci"], params: { Path: { pos: 0, arr: 1, alias: ["LiteralPath", "PSPath"] }, Filter: { pos: 1 }, Include: { arr: 1 }, Exclude: { arr: 1 }, Name: { sw: 1 }, File: { sw: 1, alias: ["af"] }, Directory: { sw: 1, alias: ["ad"] }, Recurse: { sw: 1 }, Force: { sw: 1 }, Hidden: { sw: 1 }, Depth: {} } }, function (c) {
    var self = this, P = c.P, paths = P._set_Path ? arr(P.Path) : ["."], out = [];
    paths.forEach(function (p) {
      var ents = self.expandPath(p, "Get-ChildItem");
      var hasWild = VFS.hasGlob(str(p));
      ents.forEach(function (e) {
        if (e.node.type === "d" && !(hasWild && false)) out = out.concat(listDirObjs(self, e, P));
        else { if (P.Directory) return; out.push(mkFile(self, e.node, e.name, (self.fs.resolve(e.abs + "/..", "/").abs))); }
      });
    });
    if (P.Name) return out.map(function (o) { return o.Name; });
    return out;
  });
  def("Get-Location", { aliases: ["pwd", "gl"], params: {} }, function () { return [{ __t: "Path", Path: toWin(this.st.cwd) , _s: toWin(this.st.cwd)}].map(function (o) { return "\nPath\n----\n" + o.Path + "\n"; }); });
  def("Set-Location", { aliases: ["cd", "sl", "chdir"], params: { Path: { pos: 0, alias: ["LiteralPath"] }, PassThru: { sw: 1 } } }, function (c) {
    var p = c.P.Path === undefined ? "C:\\Users\\alumno" : str(arr(c.P.Path)[0]);
    if (p === "\\") p = "C:\\";
    var ent = this.expandPath(p, "Set-Location");
    if (!ent.length) { var e = new Error("x"); e.ps = "No se encuentra la ruta de acceso '" + p + "' porque no existe."; throw e; }
    if (ent[0].node.type !== "d") { var e2 = new Error("x"); e2.ps = "El directorio especificado no existe o no es un directorio: " + p; throw e2; }
    this.st.cwd = ent[0].abs;
  });
  def("Push-Location", { aliases: ["pushd"], params: { Path: { pos: 0 } } }, function (c) { return CMDLETS["set-location"].fn.call(this, c); });

  function createItem(sh, c, forceType) {
    var P = c.P, type = forceType || (P.ItemType ? str(P.ItemType).toLowerCase() : null), made = [];
    if (!type) { var e0 = new Error("x"); e0.ps = "No se puede crear el elemento: falta el parámetro -ItemType (File o Directory)."; throw e0; }
    var isDir = /^(dir|directory|folder)/.test(type);
    if (!isDir && !/^file/.test(type)) { var e1 = new Error("x"); e1.ps = "No se admite el tipo de elemento '" + str(P.ItemType) + "'."; throw e1; }
    var targets = [];
    if (P.Name !== undefined) {
      if (Array.isArray(P.Name)) { var e2 = new Error("x"); e2.ps = "No se puede enlazar el parámetro 'Name'. No se puede convertir el valor \"System.Object[]\" de tipo \"System.Object[]\" en el tipo \"System.String\"."; throw e2; }
      var base = P._set_Path ? arr(P.Path) : ["."];
      base.forEach(function (b) { targets.push(str(b) + "\\" + str(P.Name)); });
    } else {
      if (!P._set_Path) { var e3 = new Error("x"); e3.ps = "No se puede enlazar el argumento al parámetro 'Path' porque es nulo."; throw e3; }
      targets = arr(P.Path).map(str);
    }
    targets.forEach(function (t) {
      var ip = sh.winPath(t), r = sh.fs.resolve(ip, sh.st.cwd);
      if (r.id !== null) {
        if (P.Force && !isDir) { sh.fs.writeFile(ip, sh.st.cwd, P.Value !== undefined ? str(P.Value) : "", false); made.push(mkFile(sh, sh.fs.node(r.id), r.name, sh.fs.resolve(r.abs + "/..", "/").abs)); return; }
        var e = new Error("x"); e.ps = "Ya existe un elemento con el nombre especificado: " + toWin(r.abs) + "."; e.cmd = "New-Item"; sh.err("New-Item : " + e.ps); return;
      }
      if (r.parent === undefined) {
        if (P.Force) { sh.fs.mkdir(ip.replace(/\/[^\/]*$/, "") || "/", sh.st.cwd, true); r = sh.fs.resolve(ip, sh.st.cwd); }
        else { sh.err("New-Item : No se encuentra una parte de la ruta de acceso '" + toWin(r.abs || sh.fs.resolve(ip, sh.st.cwd).abs || ip) + "'."); return; }
      }
      if (isDir) sh.fs.mkdir(ip, sh.st.cwd, false); else sh.fs.writeFile(ip, sh.st.cwd, P.Value !== undefined ? str(P.Value) : "", false);
      var rr = sh.fs.resolve(ip, sh.st.cwd);
      made.push(mkFile(sh, sh.fs.node(rr.id), rr.name, sh.fs.resolve(rr.abs + "/..", "/").abs));
    });
    return made;
  }
  def("New-Item", { aliases: ["ni"], params: { Path: { pos: 0, arr: 1 }, Name: { pos: 1 }, ItemType: { alias: ["Type"] }, Value: {}, Force: { sw: 1 } } }, function (c) { return createItem(this, c); });
  def("mkdir", { aliases: ["md"], params: { Path: { pos: 0, arr: 1 }, Name: { pos: 1 }, Value: {}, Force: { sw: 1 } } }, function (c) { return createItem(this, c, "directory"); });

  def("Copy-Item", { aliases: ["cp", "copy", "cpi"], params: { Path: { pos: 0, arr: 1 }, Destination: { pos: 1 }, Recurse: { sw: 1 }, Force: { sw: 1 }, PassThru: { sw: 1 } } }, function (c) {
    var self = this, P = c.P;
    if (P.Destination === undefined) { var e = new Error("x"); e.ps = "No se puede enlazar el argumento al parámetro 'Destination' porque es nulo."; throw e; }
    var dst = this.winPath(str(P.Destination));
    arr(P.Path).forEach(function (p) {
      var ents = self.expandPath(p, "Copy-Item");
      if (!ents.length) { self.err("Copy-Item : No se encuentra la ruta de acceso '" + toWin(self.winPath(str(p))) + "' porque no existe."); }
      ents.forEach(function (e) {
        var er = self.fs.copy(e.abs, dst, self.st.cwd, !!P.Recurse || e.node.type !== "d" ? !!P.Recurse : false);
        if (er === "ENOTR") { /* directorio sin -Recurse: copia solo la carpeta vacia */ var d2 = self.fs.resolve(dst, self.st.cwd); var tgt = d2.id !== null && self.fs.node(d2.id).type === "d" ? d2.abs + "/" + e.name : dst; self.fs.mkdir(tgt, self.st.cwd, false); }
        else if (er === "ENOENT") self.err("Copy-Item : No se encuentra una parte de la ruta de acceso '" + toWin(self.fs.resolve(dst, self.st.cwd).abs || dst) + "'.");
        else if (er === "EINVAL") self.err("Copy-Item : No se puede copiar una carpeta dentro de sí misma.");
        else if (er) self.err("Copy-Item : " + er);
      });
    });
  });
  def("Move-Item", { aliases: ["mv", "move", "mi"], params: { Path: { pos: 0, arr: 1 }, Destination: { pos: 1 }, Force: { sw: 1 } } }, function (c) {
    var self = this, P = c.P, dst = this.winPath(str(P.Destination));
    arr(P.Path).forEach(function (p) {
      self.expandPath(p, "Move-Item").forEach(function (e) {
        var er = self.fs.rename(e.abs, dst, self.st.cwd);
        if (er === "ENOENT") self.err("Move-Item : No se encuentra una parte de la ruta de acceso '" + toWin(self.fs.resolve(dst, self.st.cwd).abs || dst) + "'.");
        else if (er && er !== "SAME") self.err("Move-Item : No se puede mover el elemento (" + er + ").");
      });
    });
  });
  def("Remove-Item", { aliases: ["rm", "del", "ri", "rmdir", "erase", "rd"], params: { Path: { pos: 0, arr: 1, alias: ["LiteralPath"] }, Recurse: { sw: 1 }, Force: { sw: 1 }, Include: { arr: 1 }, Exclude: { arr: 1 }, Filter: {} } }, function (c) {
    var self = this, P = c.P;
    arr(P.Path).forEach(function (p) {
      var ents = self.expandPath(p, "Remove-Item");
      ents.forEach(function (e) {
        if (e.node.type === "d") {
          if (Object.keys(e.node.entries).length && !P.Recurse) { self.err("Remove-Item : El elemento en " + toWin(e.abs) + " tiene elementos secundarios y no se especificó el parámetro Recurse. Si continúa, todos los elementos secundarios se quitarán con el elemento."); return; }
          self.fs.removeTree(e.abs, "/");
        } else self.fs.unlink(e.abs, "/");
      });
    });
  });
  def("Rename-Item", { aliases: ["ren", "rni"], params: { Path: { pos: 0 }, NewName: { pos: 1 } } }, function (c) {
    var self = this, e = this.expandPath(str(c.P.Path), "Rename-Item")[0], er = this.fs.rename(e.abs, this.fs.resolve(e.abs + "/..", "/").abs + "/" + str(c.P.NewName), "/");
    if (er) this.err("Rename-Item : No se puede cambiar el nombre (" + er + ").");
  });

  function readLines(text) { var s = text.replace(/\r\n/g, "\n"); if (s === "") return []; var a = s.split("\n"); if (a[a.length - 1] === "") a.pop(); return a; }
  PP.readText = function (p, cmd) {
    var ents = this.expandPath(p, cmd), self = this, out = [];
    ents.forEach(function (e) { if (e.node.type === "d") { var er = new Error("x"); er.ps = "Acceso denegado a la ruta de acceso '" + toWin(e.abs) + "'."; throw er; } out.push(e.node.content); });
    return out;
  };
  def("Get-Content", { aliases: ["cat", "gc", "type"], params: { Path: { pos: 0, arr: 1, alias: ["LiteralPath", "PSPath"] }, TotalCount: { alias: ["First", "Head"] }, Tail: { alias: ["Last"] }, Raw: { sw: 1 }, Encoding: {}, Wait: { sw: 1 } } }, function (c) {
    var self = this, P = c.P, out = [];
    arr(P.Path).forEach(function (p) {
      self.readText(p, "Get-Content").forEach(function (t) {
        var ls = readLines(t);
        if (P.Raw) { out.push(t); return; }
        if (P.TotalCount !== undefined) ls = ls.slice(0, +P.TotalCount);
        if (P.Tail !== undefined) ls = +P.Tail === 0 ? [] : ls.slice(-(+P.Tail));
        out = out.concat(ls);
      });
    });
    return out;
  });
  function toText(vals, st) { return formatOut(vals, st); }
  def("Set-Content", { aliases: ["sc"], params: { Path: { pos: 0, arr: 1 }, Value: { pos: 1, arr: 1 }, Encoding: {}, Force: { sw: 1 } } }, function (c) {
    var self = this, vals = c.P._set_Value ? arr(c.P.Value) : c.input || [];
    var text = vals.map(function (v) { return str(v); }).join("\n") + (vals.length ? "\n" : "");
    arr(c.P.Path).forEach(function (p) { self.writeOut(str(p), text, false); });
  });
  def("Add-Content", { aliases: ["ac"], params: { Path: { pos: 0, arr: 1 }, Value: { pos: 1, arr: 1 }, Encoding: {}, Force: { sw: 1 } } }, function (c) {
    var self = this, vals = c.P._set_Value ? arr(c.P.Value) : c.input || [];
    var text = vals.map(function (v) { return str(v); }).join("\n") + (vals.length ? "\n" : "");
    arr(c.P.Path).forEach(function (p) { self.writeOut(str(p), text, true); });
  });
  def("Clear-Content", { aliases: ["clc"], params: { Path: { pos: 0, arr: 1 }, Force: { sw: 1 } } }, function (c) {
    var self = this; arr(c.P.Path).forEach(function (p) { self.expandPath(p, "Clear-Content").forEach(function (e) { if (e.node.type === "f") e.node.content = ""; }); });
  });
  def("Out-File", { aliases: [], params: { FilePath: { pos: 0, alias: ["Path", "LiteralPath"] }, Encoding: { pos: 1 }, Append: { sw: 1 }, NoClobber: { sw: 1 }, Force: { sw: 1 }, Width: {}, InputObject: {} }, rest: false }, function (c) {
    if (c.P.FilePath === undefined) { var e = new Error("x"); e.ps = "No se puede enlazar el argumento al parámetro 'FilePath' porque es nulo."; throw e; }
    var text = toText(c.input || [], this.st);
    if (text.charAt(0) === "\n" && !/^\n\n/.test(text) && false) text = text.slice(1);
    this.writeOut(str(c.P.FilePath), text, !!c.P.Append);
  });
  def("Out-Null", { params: {} }, function () { return []; });
  def("Out-Host", { aliases: [], params: {} }, function (c) { return c.input; });
  def("Out-String", { params: {} }, function (c) { return [toText(c.input || [], this.st).replace(/\n$/, "")]; });
  def("Write-Output", { aliases: ["echo", "write"], params: { InputObject: { pos: 0 } }, rest: true }, function (c) {
    var out = []; if (c.P._set_InputObject) out = out.concat(arr(c.P.InputObject)); c.P.rest.forEach(function (r) { out = out.concat(arr(r)); }); return out;
  });
  def("Write-Host", { params: { Object: { pos: 0 }, NoNewline: { sw: 1 }, ForegroundColor: {}, BackgroundColor: {}, Separator: {} }, rest: true }, function (c) {
    var parts = []; if (c.P._set_Object) parts.push(Array.isArray(c.P.Object) ? c.P.Object.map(str).join(" ") : str(c.P.Object)); c.P.rest.forEach(function (r) { parts.push(Array.isArray(r) ? r.map(str).join(" ") : str(r)); });
    this.host.push({ e: false, s: parts.join(" ") + (c.P.NoNewline ? "" : "\n") }); return [];
  });
  def("Write-Error", { params: { Message: { pos: 0 } } }, function (c) { this.err("Write-Error: " + str(c.P.Message)); });
  def("Clear-Host", { aliases: ["cls", "clear"], params: {} }, function () { this.clearFlag = true; });

  def("Select-String", { aliases: ["sls"], params: { Pattern: { pos: 0, arr: 1 }, Path: { pos: 1, arr: 1, alias: ["LiteralPath"] }, SimpleMatch: { sw: 1 }, CaseSensitive: { sw: 1 }, NotMatch: { sw: 1 }, InputObject: {}, Context: {}, AllMatches: { sw: 1 } } }, function (c) {
    var self = this, P = c.P;
    if (P.Pattern === undefined) { var e = new Error("x"); e.ps = "No se puede enlazar el argumento al parámetro 'Pattern' porque es nulo."; throw e; }
    var pats = arr(P.Pattern).map(function (p) { return P.SimpleMatch ? str(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : str(p); });
    var re;
    try { re = new RegExp(pats.join("|"), P.CaseSensitive ? "" : "i"); } catch (er) { var e2 = new Error("x"); e2.ps = "No se puede analizar la expresión regular: " + str(P.Pattern); throw e2; }
    var out = [];
    function scan(lines, name) { lines.forEach(function (l, i) { var m = re.test(l); if (P.NotMatch) m = !m; if (m) out.push({ __t: "Match", path: name, n: i + 1, line: l, Line: l, LineNumber: i + 1, Filename: name || "InputStream", Path: name || "InputStream" }); }); }
    if (P._set_Path) arr(P.Path).forEach(function (p) { self.expandPath(p, "Select-String").forEach(function (e) { if (e.node.type === "f") scan(readLines(e.node.content), arr(P.Path).length > 1 || VFS.hasGlob(str(p)) ? e.name : str(p).replace(/^\.\\/, "")); }); });
    else (c.input || []).forEach(function (v) { if (typeof v === "string") scan(readLines(v).length ? [v] : [v], null); });
    return out;
  });

  function sortVals(vals, props, desc, uniq) {
    var keyFn = function (v) { return props.length ? props.map(function (p) { return typeof p === "string" ? getProp(v, p) : p.e; }) : [v]; };
    var arr2 = vals.map(function (v, i) { return { v: v, k: keyFn(v), i: i }; });
    arr2.sort(function (a, b) {
      for (var i = 0; i < a.k.length; i++) { var x = a.k[i], y = b.k[i]; var r = cmpVals(x === undefined ? "" : x, y === undefined ? "" : y); if (r !== 0) return desc ? -r : r; }
      return a.i - b.i;
    });
    var res = arr2.map(function (x) { return x.v; });
    if (uniq) res = res.filter(function (v, i) { return i === 0 || str(v) !== str(res[i - 1]); });
    return res;
  }
  def("Sort-Object", { aliases: ["sort"], params: { Property: { pos: 0, arr: 1 }, Descending: { sw: 1 }, Unique: { sw: 1 }, Ascending: { sw: 1 }, CaseSensitive: { sw: 1 } } }, function (c) {
    var props = arr(c.P.Property).map(function (p) { return typeof p === "string" ? p : str(p); });
    return sortVals(c.input || [], props, !!c.P.Descending, !!c.P.Unique);
  });
  def("Measure-Object", { aliases: ["measure"], params: { InputObject: {}, Property: { pos: 0 }, Line: { sw: 1 }, Word: { sw: 1 }, Character: { sw: 1 }, Sum: { sw: 1 }, Average: { sw: 1 }, Maximum: { sw: 1 }, Minimum: { sw: 1 } } }, function (c) {
    var inp = c.input || [], P = c.P;
    if (P.Line || P.Word || P.Character) {
      var text = inp.map(str), o = { __t: "Measure" };
      if (P.Line) o.Lines = text.length; if (P.Word) o.Words = text.join(" ").trim() ? text.join(" ").trim().split(/\s+/).length : 0; if (P.Character) o.Characters = text.join("").length; o.Property = "";
      return [o];
    }
    var vals = P.Property !== undefined ? inp.map(function (v) { return getProp(v, str(P.Property)); }) : inp;
    var o2 = { __t: "Measure", __list: true, Count: inp.length, Average: "", Sum: "", Maximum: "", Minimum: "", Property: P.Property !== undefined ? str(P.Property) : "" };
    var nums = vals.filter(function (x) { return typeof x === "number"; });
    if (P.Sum) o2.Sum = nums.reduce(function (a, b) { return a + b; }, 0); if (P.Average) o2.Average = nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : ""; if (P.Maximum) o2.Maximum = Math.max.apply(null, nums); if (P.Minimum) o2.Minimum = Math.min.apply(null, nums);
    return [o2];
  });
  def("Select-Object", { aliases: ["select"], params: { Property: { pos: 0, arr: 1 }, First: {}, Last: {}, Skip: {}, ExpandProperty: {}, Unique: { sw: 1 }, InputObject: {} } }, function (c) {
    var inp = c.input || [], P = c.P, out = inp.slice();
    if (P.Skip !== undefined) out = out.slice(+P.Skip);
    if (P.First !== undefined) out = out.slice(0, +P.First);
    if (P.Last !== undefined) out = out.slice(-(+P.Last));
    if (P.ExpandProperty !== undefined) return [].concat.apply([], out.map(function (v) { return arr(getProp(v, str(P.ExpandProperty))); }));
    if (P._set_Property) {
      var props = arr(P.Property).map(str);
      out = out.map(function (v) {
        if (props.length === 1 && props[0] === "*") return v;
        var o = { __t: "Obj" };
        props.forEach(function (p) { var val = getProp(v, p); o[isObj(v) && hasProp(v, p) ? propKey(v, p) : p] = val === undefined ? null : val; });
        return o;
      });
    }
    if (P.Unique) out = out.filter(function (v, i) { return out.findIndex(function (w) { return str(w) === str(v); }) === i; });
    return out;
  });
  def("Where-Object", { aliases: ["where", "?"], params: { Property: { pos: 0 }, FilterScript: {}, Value: { pos: 1 }, EQ: {}, NE: {}, GT: {}, GE: {}, LT: {}, LE: {}, Like: {}, NotLike: {}, Match: {}, NotMatch: {}, Contains: {}, NotContains: {}, In: {}, NotIn: {}, CEQ: {}, IEQ: {}, InputObject: {} } }, function (c) {
    var self = this, P = c.P, inp = c.input || [], blk = P.FilterScript || (P.Property && P.Property.__block ? P.Property : null);
    if (blk) return inp.filter(function (v) { return truthy(self.callBlock(blk, v, c.scope)); });
    var ops = ["EQ", "NE", "GT", "GE", "LT", "LE", "Like", "NotLike", "Match", "NotMatch", "Contains", "NotContains", "In", "NotIn", "CEQ", "IEQ"], op = null, val;
    ops.forEach(function (o) { if (P["_set_" + o]) { op = o.toLowerCase(); val = P[o]; } });
    if (!op) { return inp.filter(function (v) { return truthy(getProp(v, str(P.Property))); }); }
    return inp.filter(function (v) { return compareOp(op, getProp(v, str(P.Property)), val); });
  });
  def("ForEach-Object", { aliases: ["foreach", "%"], params: { Process: { pos: 0 }, MemberName: {} }, }, function (c) {
    var self = this, blk = c.P.Process, out = [];
    if (blk && blk.__block) (c.input || []).forEach(function (v) { out = out.concat(arr(self.callBlock(blk, v, c.scope))); });
    return out;
  });
  def("Format-Table", { aliases: ["ft"], params: { Property: { pos: 0, arr: 1 }, AutoSize: { sw: 1 }, Wrap: { sw: 1 } } }, function (c) {
    var inp = c.input || [], props = c.P._set_Property ? arr(c.P.Property).map(str) : null;
    if (!inp.length) return [];
    var keys = props || Object.keys(inp[0]).filter(function (k) { return k !== "__t"; });
    return [table(inp, keys.map(function (k) { return { h: k, k: k, right: typeof getProp(inp[0], k) === "number" }; })).replace(/\n$/, "")];
  });
  def("Format-List", { aliases: ["fl"], params: { Property: { pos: 0, arr: 1 } } }, function (c) {
    var inp = c.input || [], props = c.P._set_Property ? arr(c.P.Property).map(str) : null;
    return [list(inp, props || undefined).replace(/\n$/, "")];
  });
  def("Get-Date", { params: { Format: {}, Date: { pos: 0 } } }, function (c) {
    var d = new Date(VFS.BASE_TIME);
    if (c.P.Format !== undefined) { var f = str(c.P.Format); return [f.replace(/yyyy/g, d.getFullYear()).replace(/MM/g, pad2(d.getMonth() + 1)).replace(/dd/g, pad2(d.getDate())).replace(/HH/g, pad2(d.getHours())).replace(/mm/g, pad2(d.getMinutes())).replace(/ss/g, pad2(d.getSeconds()))]; }
    return [Sim.strftime("%A, %e de %B de %Y %H:%M:%S", d).replace(/ +/g, " ")];
  });

  /* procesos y servicios */
  function procObj(p) { return { __t: "Process", Handles: p.handles, NPM: p.npm, PM: p.pm, WS: p.ws, CPU: p.cpu, Id: p.id, SI: p.si, ProcessName: p.name, Name: p.name }; }
  def("Get-Process", { aliases: ["gps", "ps"], params: { Name: { pos: 0, arr: 1, alias: ["ProcessName"] }, Id: {}, InputObject: {} } }, function (c) {
    var self = this, P = c.P, out = this.st.procs.slice();
    if (P._set_Name) {
      var names = arr(P.Name).map(str), res = [];
      names.forEach(function (n) { var m = out.filter(function (p) { return wild(n, p.name); }); if (!m.length && !VFS.hasGlob(n)) self.err("Get-Process : No se encuentra ningún proceso con el nombre \"" + n + "\". Compruebe el nombre del proceso y vuelva a llamar al cmdlet."); res = res.concat(m); });
      out = res;
    }
    if (P._set_Id) { var ids = arr(P.Id).map(Number); out = out.filter(function (p) { return ids.indexOf(p.id) >= 0; }); }
    return out.map(procObj);
  });
  def("Stop-Process", { aliases: ["kill", "spps"], params: { Name: { arr: 1 }, Id: { pos: 0, arr: 1 }, Force: { sw: 1 }, InputObject: {} } }, function (c) {
    var self = this, P = c.P, removed = 0;
    if (P._set_Name) {
      arr(P.Name).forEach(function (n) {
        var before = self.st.procs.length;
        self.st.procs = self.st.procs.filter(function (p) { return !wild(str(n), p.name); });
        if (before === self.st.procs.length) self.err("Stop-Process : No se encuentra ningún proceso con el nombre \"" + str(n) + "\". Compruebe el nombre del proceso y vuelva a llamar al cmdlet.");
      });
      return;
    }
    var ids = P._set_Id ? arr(P.Id).map(Number) : (c.input || []).map(function (o) { return getProp(o, "Id"); });
    ids.forEach(function (id) { var i = self.st.procs.findIndex(function (p) { return p.id === id; }); if (i < 0) self.err("Stop-Process : No se encuentra ningún proceso con el identificador " + id + "."); else self.st.procs.splice(i, 1); });
  });
  def("Start-Process", { aliases: ["start", "saps"], params: { FilePath: { pos: 0 }, ArgumentList: { pos: 1 }, PassThru: { sw: 1 }, Wait: { sw: 1 } } }, function (c) {
    var name = str(c.P.FilePath).replace(/\.exe$/i, "").split("\\").pop();
    var known = { notepad: 1, calc: 1, mspaint: 1, chrome: 1, explorer: 1, cmd: 1, powershell: 1 };
    if (!known[name.toLowerCase()]) { this.err("Start-Process : Este comando no se puede ejecutar debido al error: El sistema no puede encontrar el archivo especificado."); return; }
    var id = this.st.nextPid; this.st.nextPid += 4;
    this.st.procs.push({ name: name.toLowerCase(), id: id, npm: 12, pm: 2480, ws: 14200, handles: 285, cpu: 0.06, si: 1 });
    if (c.P.PassThru) return [procObj(this.st.procs[this.st.procs.length - 1])];
  });
  function svcObj(s) { return { __t: "Service", Status: s.status, Name: s.name, DisplayName: s.display }; }
  function findSvc(sh, n) { return sh.st.services.filter(function (s) { return wild(n, s.name) || wild(n, s.display); }); }
  def("Get-Service", { aliases: ["gsv"], params: { Name: { pos: 0, arr: 1, alias: ["ServiceName"] }, DisplayName: { arr: 1 }, InputObject: {} } }, function (c) {
    var self = this, P = c.P, out = this.st.services.slice();
    if (P._set_Name) { var res = []; arr(P.Name).forEach(function (n) { var m = self.st.services.filter(function (s) { return wild(str(n), s.name); }); if (!m.length && !VFS.hasGlob(str(n))) self.err("Get-Service : No se encuentra ningún servicio con el nombre de servicio '" + str(n) + "'."); res = res.concat(m); }); out = res; }
    if (P._set_DisplayName) { out = out.filter(function (s) { return arr(P.DisplayName).some(function (n) { return wild(str(n), s.display); }); }); }
    return out.map(svcObj);
  });
  function svcAction(status) {
    return function (c) {
      var self = this, names = c.P._set_Name ? arr(c.P.Name).map(str) : (c.input || []).map(function (o) { return getProp(o, "Name"); });
      names.forEach(function (n) {
        var m = self.st.services.filter(function (s) { return wild(n, s.name) || wild(n, s.display); });
        if (!m.length) { self.err(c.name + " : No se encontró ningún servicio con el nombre de servicio '" + n + "'."); return; }
        m.forEach(function (s) { s.status = status; });
      });
    };
  }
  def("Start-Service", { aliases: ["sasv"], params: { Name: { pos: 0, arr: 1, alias: ["ServiceName"] }, PassThru: { sw: 1 } } }, svcAction("Running"));
  def("Stop-Service", { aliases: ["spsv"], params: { Name: { pos: 0, arr: 1, alias: ["ServiceName"] }, Force: { sw: 1 }, PassThru: { sw: 1 } } }, svcAction("Stopped"));
  def("Restart-Service", { params: { Name: { pos: 0, arr: 1 }, Force: { sw: 1 } } }, svcAction("Running"));

  /* sistema */
  var CI = { CsName: "DESKTOP-4K2A9LB", WindowsProductName: "Windows 10 Pro", WindowsVersion: "2009", OsName: "Microsoft Windows 10 Pro", OsVersion: "10.0.19045", OsBuildNumber: "19045", OsArchitecture: "64 bits", OsLastBootUpTime: "08/01/2025 12:22:04", OsTotalVisibleMemorySize: 8145060, OsFreePhysicalMemory: 3412896, CsManufacturer: "Dell Inc.", CsModel: "OptiPlex 3070", CsProcessors: ["Intel(R) Core(TM) i5-8500 CPU @ 3.00GHz"], CsNumberOfLogicalProcessors: 6, KeyboardLayout: "es-ES", TimeZone: "(UTC+01:00) Bruselas, Copenhague, Madrid, París", OsLanguage: "es-ES", WindowsRegisteredOwner: "alumno", BiosVersion: "{DELL - 1072009}" };
  def("Get-ComputerInfo", { params: { Property: { pos: 0, arr: 1 } } }, function (c) {
    var props = c.P._set_Property ? arr(c.P.Property).map(str) : Object.keys(CI), o = { __t: "List" }, ps = [];
    props.forEach(function (p) { var k = Object.keys(CI).filter(function (x) { return x.toLowerCase() === p.toLowerCase(); })[0]; if (k) { o[k] = CI[k]; ps.push(k); } });
    if (!ps.length) return [];
    o.__props = ps;
    return [o];
  });
  def("Get-PSDrive", { aliases: ["gdr"], params: { Name: { pos: 0 } } }, function () {
    var rows = [["Alias", "", "", "Alias", ""], ["C", "52,73", "179,30", "FileSystem", "C:\\"], ["Cert", "", "", "Certificate", "\\"], ["D", "9,14", "86,86", "FileSystem", "D:\\"], ["Env", "", "", "Environment", ""], ["Function", "", "", "Function", ""], ["HKCU", "", "", "Registry", "HKEY_CURRENT_USER"], ["HKLM", "", "", "Registry", "HKEY_LOCAL_MACHINE"], ["Variable", "", "", "Variable", ""], ["WSMan", "", "", "WSMan", ""]];
    return rows.map(function (r) { return { __t: "Drive", Name: r[0], Used: r[1], Free: r[2], Provider: r[3], Root: r[4], Cur: r[0] === "C" ? "Users\\alumno" : "" }; });
  });
  def("Get-HotFix", { params: {} }, function () {
    return [["KB5034441", "Update", "NT AUTHORITY\\SYSTEM", "10/01/2024 0:00:00"], ["KB5033372", "Security Update", "NT AUTHORITY\\SYSTEM", "13/12/2023 0:00:00"], ["KB5032189", "Security Update", "NT AUTHORITY\\SYSTEM", "15/11/2023 0:00:00"]].map(function (r) { return { __t: "Hotfix", Source: "DESKTOP-4K2A9LB", Description: r[1], HotFixID: r[0], InstalledBy: r[2], InstalledOn: r[3] }; });
  });
  var WMI = {
    win32_operatingsystem: { SystemDirectory: "C:\\WINDOWS\\system32", Organization: "", BuildNumber: "19045", RegisteredUser: "alumno", SerialNumber: "00331-10000-00001-AA123", Version: "10.0.19045", Caption: "Microsoft Windows 10 Pro", OSArchitecture: "64 bits" },
    win32_processor: { Caption: "Intel64 Family 6 Model 158 Stepping 10", DeviceID: "CPU0", Manufacturer: "GenuineIntel", MaxClockSpeed: 3000, Name: "Intel(R) Core(TM) i5-8500 CPU @ 3.00GHz", SocketDesignation: "U3E1", NumberOfCores: 6, NumberOfLogicalProcessors: 6 },
    win32_computersystem: { Domain: "WORKGROUP", Manufacturer: "Dell Inc.", Model: "OptiPlex 3070", Name: "DESKTOP-4K2A9LB", PrimaryOwnerName: "alumno", TotalPhysicalMemory: 8340541440 },
    win32_bios: { SMBIOSBIOSVersion: "1.12.0", Manufacturer: "Dell Inc.", Name: "1.12.0", SerialNumber: "7K3M2Y2", Version: "DELL   - 1072009" }
  };
  def("Get-WmiObject", { aliases: ["gwmi"], params: { Class: { pos: 0 }, ComputerName: {}, Namespace: {} } }, function (c) {
    var k = WMI[str(c.P.Class).toLowerCase()];
    if (!k) { var e = new Error("x"); e.ps = "Clase no válida \"" + str(c.P.Class) + "\""; throw e; }
    var o = { __t: "List" }; Object.keys(k).forEach(function (x) { o[x] = k[x]; }); o.__props = Object.keys(k); return [o];
  });
  CMDLETS["get-ciminstance"] = CMDLETS["get-wmiobject"]; ALIASES["gcim"] = "Get-WmiObject";

  def("Get-Help", { aliases: ["help", "man"], params: { Name: { pos: 0 } } }, function (c) {
    var n = c.P.Name ? str(c.P.Name) : null;
    if (!n) return ["TEMA\n    Simulador de PowerShell.\n\nCmdlets disponibles:\n  " + Object.keys(CMDLETS).filter(function (k) { return k.indexOf("native:") < 0; }).map(function (k) { return CMDLETS[k].name; }).sort().join("\n  ") + "\n\nUsa Get-Help <cmdlet> para ver los parámetros."];
    var s = this.find(n); if (!s) { this.err("Get-Help : No se encontró ninguna coincidencia para el comando '" + n + "'."); return []; }
    return ["NOMBRE\n    " + s.name + "\n\nALIAS\n    " + (s.aliases || []).join(", ") + "\n\nPARÁMETROS\n    " + Object.keys(s.params || {}).map(function (p) { return "-" + p + (s.params[p].sw ? " (switch)" : ""); }).join("\n    ")];
  });
  def("Get-Alias", { aliases: ["gal"], params: { Name: { pos: 0 } } }, function () { return Object.keys(ALIASES).sort().map(function (a) { return a + " -> " + ALIASES[a]; }); });
  def("Get-Command", { aliases: ["gcm"], params: { Name: { pos: 0 } } }, function (c) { var s = c.P.Name ? this.find(str(c.P.Name)) : null; return s ? [s.name] : []; });

  /* programas nativos */
  var TREE_HELP = "Muestra gráficamente la estructura de carpetas de una unidad o ruta de acceso.\n\nTREE [unidad:][ruta] [/F] [/A]\n\n   /F   Muestra los nombres de los archivos de cada carpeta.\n   /A   Usa ASCII en lugar de caracteres extendidos.\n";
  function nativeArgs(c) { return c.P.rest.map(str); }
  def("native:tree", { params: {}, rest: true }, function (c) {
    var a = nativeArgs(c), self = this;
    if (a.some(function (x) { return x === "/?"; })) return readLines(TREE_HELP);
    var showFiles = a.some(function (x) { return /^\/f$/i.test(x); }), ascii = a.some(function (x) { return /^\/a$/i.test(x); });
    var target = a.filter(function (x) { return x.charAt(0) !== "/"; })[0];
    var ents = target ? this.expandPath(target, "tree") : [{ abs: this.st.cwd, node: this.fs.node(this.fs.resolve(this.st.cwd, "/").id) }];
    var e = ents[0], lines = ["Listado de rutas de carpetas", "El número de serie del volumen es 7A2C-91B4", target ? toWin(e.abs).toUpperCase() : "C:."];
    var T = ascii ? { b: "+---", l: "\\---", v: "|   " } : { b: "├───", l: "└───", v: "│   " };
    function walk(node, prefix) {
      var names = Object.keys(node.entries).sort(VFS.cmpName), dirs = names.filter(function (k) { return self.fs.node(node.entries[k]).type === "d"; });
      var files = showFiles ? names.filter(function (k) { return self.fs.node(node.entries[k]).type !== "d"; }) : [];
      var vp = prefix + (dirs.length ? T.v : "    ");
      files.forEach(function (f) { lines.push(vp + f); });
      if (files.length && dirs.length) lines.push(vp.replace(/\s+$/, ""));
      dirs.forEach(function (d, i) { var last = i === dirs.length - 1; lines.push(prefix + (last ? T.l : T.b) + d); walk(self.fs.node(node.entries[d]), prefix + (last ? "    " : T.v)); });
    }
    var topDirs = Object.keys(e.node.entries).filter(function (k) { return self.fs.node(e.node.entries[k]).type === "d"; });
    walk(e.node, "");
    if (!topDirs.length && !showFiles) { lines.push("No existe ninguna subcarpeta"); lines.push(""); }
    return lines;
  });
  def("native:hostname", { params: {}, rest: true }, function () { return ["DESKTOP-4K2A9LB"]; });
  def("native:whoami", { params: {}, rest: true }, function () { return ["desktop-4k2a9lb\\alumno"]; });
  def("native:ver", { params: {}, rest: true }, function () { return ["", "Microsoft Windows [Versión 10.0.19045.3803]"]; });
  def("native:notepad", { params: {}, rest: true }, function () { var id = this.st.nextPid; this.st.nextPid += 4; this.st.procs.push({ name: "notepad", id: id, npm: 12, pm: 2480, ws: 14200, handles: 285, cpu: 0.06, si: 1 }); });
  def("native:calc", { params: {}, rest: true }, function () { });
  def("native:cmd", { params: {}, rest: true }, function () { return ["Microsoft Windows [Versión 10.0.19045.3803]", "(c) Microsoft Corporation. Todos los derechos reservados."]; });
  def("native:ipconfig", { params: {}, rest: true }, function () { return ["", "Configuración IP de Windows", "", "Adaptador de Ethernet Ethernet:", "", "   Sufijo DNS específico para la conexión. . :", "   Dirección IPv4. . . . . . . . . . . . . . : 192.168.1.34", "   Máscara de subred . . . . . . . . . . . . : 255.255.255.0", "   Puerta de enlace predeterminada . . . . . : 192.168.1.1"]; });
  def("native:systeminfo", { params: {}, rest: true }, function () {
    return ["", "Nombre de host:                             DESKTOP-4K2A9LB", "Nombre del sistema operativo:               Microsoft Windows 10 Pro", "Versión del sistema operativo:              10.0.19045 N/D Compilación 19045", "Fabricante del sistema operativo:           Microsoft Corporation", "Configuración del SO:                       Estación de trabajo independiente", "Tipo de compilación del sistema operativo:  Multiprocessor Free", "Propietario registrado:                     alumno", "Organización registrada:                    N/D", "Id. del producto:                           00331-10000-00001-AA123", "Fecha de instalación original:              10/09/2024, 9:12:33", "Tiempo de arranque del sistema:             8/1/2025, 12:22:04", "Fabricante del sistema:                     Dell Inc.", "Modelo el sistema:                          OptiPlex 3070", "Tipo de sistema:                            x64-based PC", "Procesador(es):                             1 Procesadores instalados.", "                                            [01]: Intel64 Family 6 Model 158 Stepping 10 GenuineIntel ~3000 Mhz", "Versión del BIOS:                           Dell Inc. 1.12.0, 14/08/2023", "Directorio de Windows:                      C:\\WINDOWS", "Directorio del sistema:                     C:\\WINDOWS\\system32", "Configuración regional del sistema:         es;Español (España, internacional)", "Zona horaria:                               (UTC+01:00) Bruselas, Copenhague, Madrid, París", "Memoria física total:                       7.954 MB", "Memoria física disponible:                  3.332 MB", "Memoria virtual: tamaño máximo:             11.538 MB", "Memoria virtual: disponible:                6.402 MB", "Memoria virtual: en uso:                    5.136 MB", "Dominio:                                    WORKGROUP", "Servidor de inicio de sesión:               \\\\DESKTOP-4K2A9LB", "Revisión(es):                               3 revisión(es) instaladas."];
  });

  Sim.psCommandNames = function () { return Object.keys(CMDLETS).filter(function (k) { return k.indexOf("native:") < 0; }).map(function (k) { return CMDLETS[k].name; }).concat(Object.keys(ALIASES), ["tree", "systeminfo", "hostname", "whoami"]); };
})(typeof window !== "undefined" ? window : globalThis);
