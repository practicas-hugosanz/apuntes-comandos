/* Series de ejercicios + corrector.
   Usa los bancos E (Linux) y P (PowerShell) de datos.js.
   El estado del simulador se arrastra de un ejercicio al siguiente, como en el examen. */
(function (g) {
  "use strict";
  var Sim = g.Sim = g.Sim || {};
  var VFS = g.VFS;

  var NOTAS = [
    "Pablo:Garcia:Lopez:7:5:8", "Daniela:Martin:Ruiz:9:6:7", "Pablo:Sanz:Gil:4:8:6", "Lucia:Perez:Mora:10:9:9", "Marcos:Navarro:Vidal:3:5:4",
    "Irene:Soler:Pons:8:8:9", "Hugo:Ferrer:Gil:6:7:5", "Carla:Ortega:Rey:10:10:9", "Ivan:Molina:Cano:5:4:6", "Noelia:Marti:Gomez:7:9:8",
    "Pablo:Ruiz:Serra:2:6:7", "Alba:Dominguez:Pla:9:8:10", "Sergio:Vega:Blasco:4:3:5", "Marta:Roig:Esteve:8:7:7", "Daniel:Calvo:Mas:6:6:6",
    "Laura:Iglesias:Bono:10:7:8", "Adrian:Cabrera:Luna:5:9:4", "Paula:Santos:Peña:7:7:9", "Raul:Herrero:Cid:3:8:6", "Elena:Prieto:Ros:9:10:10"
  ];
  Sim.NOTAS = NOTAS;

  function quiet(sh, line) { sh.run(line, true); }
  function homeShell(sh) { sh.st.cwd = "/home/lliurex"; sh.st.oldpwd = "/home/lliurex"; }
  function linuxLab(sh, notasOnly) {
    sh.fs.mkdir("Ejercicios/CFGS", "/home/lliurex", true);
    sh.st.cwd = "/home/lliurex/Ejercicios/CFGS";
    sh.fs.writeFile("notas.txt", sh.st.cwd, NOTAS.join("\n") + "\n", false);
    if (notasOnly) return;
    sh.fs.writeFile("prueba.txt", sh.st.cwd, "Linux es genial\nAprendiendo comandos\n", false);
    sh.fs.writeFile("archivo1.txt", sh.st.cwd, "mié ene  8 14:35:45 CET 2025\n", false);
    quiet(sh, "cal > archivo2.txt");
    quiet(sh, "cat archivo1.txt archivo2.txt > combinado.txt");
  }
  function psLab(sh, withNotas) {
    var cw = "/";
    ["PS/cursos/componentes", "PS/cursos/dispositivos", "PS/cursos/sistemas/linux", "PS/cursos/sistemas/macos", "PS/cursos/sistemas/windows"].forEach(function (d) { sh.fs.mkdir("/" + d, cw, true); });
    sh.st.cwd = "/PS";
    if (withNotas) sh.fs.writeFile("notas.txt", "/PS", NOTAS.join("\n") + "\n", false);
  }

  /* definicion de series: [primerId, ultimoId] sobre el orden de E / P */
  Sim.SERIES = {
    linux: [
      { id: "l1", title: "Rutas y comodines", sub: "ls con *, ? y pwd", from: "4.001", to: "4.009", setup: function (sh) { homeShell(sh); } },
      { id: "l2", title: "Carpetas, ficheros y redirecciones", sub: "mkdir, cd, cp, mv, rm, echo, cat, >, >>", from: "4.010", to: "4.037", setup: function (sh) { homeShell(sh); } },
      { id: "l3", title: "Buscar y filtrar contenido", sub: "grep, sort, cut, tr, wc, head, tail, gzip", from: "4.038", to: "4.076", setup: function (sh) { linuxLab(sh, false); } },
      { id: "l4", title: "Enlaces e inodos", sub: "ln, ln -s, ls -i", from: "4.077", to: "4.092", setup: function (sh) { linuxLab(sh, true); } },
      { id: "l5", title: "Permisos con chmod", sub: "octal y simbólico", from: "4.093", to: "4.106", setup: function (sh) { linuxLab(sh, true); } },
      { id: "l6", title: "Información del sistema", sub: "uname, free, df, lsblk, date, cal…", from: "4.107", to: "4.121", setup: function (sh) { homeShell(sh); } },
      { id: "l7", title: "Procesos, discos y paquetes", sub: "ps, kill, du, apt, htop", from: "4.122", to: "4.133", setup: function (sh) { homeShell(sh); } }
    ],
    ps: [
      { id: "p1", title: "Carpetas con New-Item", sub: "New-Item, Set-Location, mkdir, tree", from: "ps1", to: "ps10", setup: function (sh) { sh.st.cwd = "/"; } },
      { id: "p2", title: "Archivos: crear, copiar y borrar", sub: "New-Item, Copy-Item, Remove-Item, Get-ChildItem", from: "ps21", to: "ps30", setup: function (sh) { psLab(sh, false); } },
      { id: "p3", title: "Contenido de ficheros", sub: "Get-Content, Select-String, Sort-Object, Out-File", from: "ps31", to: "ps60", setup: function (sh) { psLab(sh, true); } },
      { id: "p4", title: "Sistema, servicios y procesos", sub: "Get-ComputerInfo, Get-Service, Get-Process, systeminfo", from: "ps61", to: "ps90", setup: function (sh) { psLab(sh, true); } }
    ]
  };

  /* efectos que deja un ejercicio de concepto (para que el estado siga igual que en el examen) */
  var EFFECTS = { "4.091": ["rm notas.txt"] };
  /* respuestas alternativas aceptadas tal cual */
  var ACCEPT = { "4.130": ["pkill chrome"], "4.118": ["date +\"%Y-%m-%d %H:%M:%S\""] };
  var NOSIGIL = { "4.132": true };
  /* comando que SI funciona, para avanzar el estado y comparar efectos cuando la solucion guardada falla en un shell real */
  var ALT = { "4.099": "chmod a=rwx notas.txt", "4.103": "chmod u=rw,go= notas.txt", "4.105": "chmod u=rw,go=r notas.txt", "4.130": "pkill chrome" };

  var CONCEPT = /^(\d+|iguales|Distintos|error|l|-[-rwx]{9})$/;

  function indexOfId(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i][0] === id) return i; return -1; }

  Sim.seriesItems = function (os, serie) {
    var data = os === "linux" ? (typeof E !== "undefined" ? E : g.E) : (typeof P !== "undefined" ? P : g.P);
    var a = indexOfId(data, serie.from), b = indexOfId(data, serie.to);
    return data.slice(a, b + 1).map(function (e) { return { id: e[0], q: e[1], sol: e[2], flag: e[3], mine: e[4] || "", note: e[5] || "", concept: os === "linux" && CONCEPT.test(e[2]) }; });
  };

  function newShell(os) { return os === "linux" ? new Sim.LinuxShell(Sim.newLinuxState()) : new Sim.PSShell(Sim.newPSState()); }

  /* huella canonica del estado, ignorando numeros de inodo y el historial */
  function canon(sh) {
    var fs = sh.fs, st = sh.st, out = [], seen = {};
    (function walk(id, path) {
      var n = fs.node(id), key = n.type === "d" ? "d" : (seen[id] === undefined ? (seen[id] = path) : seen[id]);
      var desc = [path, n.type, n.mode, n.type === "f" ? n.content : (n.target || ""), n.type === "f" ? "" : "", n.gz ? "gz" : "", key !== "d" ? "L:" + key : ""];
      out.push(desc.join("|"));
      if (n.type === "d") Object.keys(n.entries).sort().forEach(function (k) { walk(n.entries[k], path + "/" + k); });
    })(st.fs.root, "");
    out.push("cwd=" + st.cwd);
    out.push("procs=" + JSON.stringify(st.procs));
    if (st.services) out.push("svc=" + JSON.stringify(st.services));
    if (st.installed) out.push("inst=" + JSON.stringify(st.installed));
    return out.join("\n");
  }
  function plain(res) { return res.text.map(function (t) { return (t.e ? "!" : "") + t.s; }).join("").replace(/\x1b\[[0-9;]*m/g, "").replace(/[ \t]+\n/g, "\n").replace(/\s+$/, ""); }
  function hasError(res) { return res.text.some(function (t) { return t.e; }); }

  /* ---------------------------------------------------------- sesion de practica */
  function Practice(os, serieId) {
    this.os = os;
    this.serie = Sim.SERIES[os].filter(function (s) { return s.id === serieId; })[0];
    this.items = Sim.seriesItems(os, this.serie);
    this.exam = false;
    this.reset();
  }
  Sim.Practice = Practice;
  var PR = Practice.prototype;

  PR.reset = function () {
    this.shell = newShell(this.os);
    this.serie.setup(this.shell);
    this.idx = 0; this.results = {}; this.attempts = {}; this.hints = 0;
  };
  PR.current = function () { return this.items[this.idx] || null; };
  PR.finished = function () { return this.idx >= this.items.length; };
  PR.sigil = function () { return this.os === "linux" ? "$ " : "> "; };

  PR.clone = function () { var sh = newShell(this.os); sh.st = JSON.parse(JSON.stringify(this.shell.st)); sh.fs = new VFS(sh.st.fs, this.os === "ps"); return sh; };
  PR.restore = function (snapStr) { this.shell.st = JSON.parse(snapStr); this.shell.fs = new VFS(this.shell.st.fs, this.os === "ps"); };
  PR.snapshot = function () { return JSON.stringify(this.shell.st); };

  /* ejecuta el comando de referencia sobre la copia */
  PR.runRef = function (sh, ex) {
    if (ex.concept) { (EFFECTS[ex.id] || []).forEach(function (c) { sh.run(c, true); }); return { text: [], status: 0 }; }
    return sh.run(ALT[ex.id] || ex.sol, true);
  };

  /* Avanza saltando (ejecuta la solucion para mantener el estado) */
  PR.skip = function () {
    var ex = this.current(); if (!ex) return;
    var r = this.runRef(this.shell, ex);
    this.results[ex.id] = "skip"; this.idx++; this.hints = 0;
    return r;
  };

  PR.norm = function (s) { return s.trim().replace(/\s+/g, " ").replace(/'/g, "\""); };

  /* Devuelve {ok, kind, msg, res}. Ejecuta la respuesta en el shell real (para que se vea en el terminal). */
  PR.submit = function (answer) {
    var ex = this.current(); if (!ex) return null;
    var raw = answer.replace(/\s+$/, ""), sig = this.sigil(), os = this.os, exam = this.exam;
    var hasSig = os === "linux" ? /^\$ /.test(raw) : /^> /.test(raw);
    var cmd = raw.replace(/^\s*[$>]\s?/, "");
    var result = { ok: false, kind: "wrong", msg: "", cmd: cmd, res: null, sig: hasSig };
    this.attempts[ex.id] = (this.attempts[ex.id] || 0) + 1;
    if (!raw.trim()) { result.msg = "Escribe tu respuesta."; return result; }

    // ejercicios de concepto: solo la palabra o numero
    if (ex.concept) {
      var okc = raw.trim().toLowerCase() === ex.sol.toLowerCase() || (/^-[-rwx]{9}$/.test(ex.sol) && /^-[-rwx]{9}$/.test(raw.trim()));
      if (exam && okc && raw.trim() !== ex.sol && !/^-[-rwx]{9}$/.test(ex.sol)) { okc = false; result.msg = "Se acepta la palabra exacta: «" + ex.sol + "» (mayúsculas incluidas)."; }
      if (okc) { result.ok = true; result.kind = "exact"; result.msg = "¡Correcto!"; (EFFECTS[ex.id] || []).forEach(function (c) { this.shell.run(c, true); }, this); this.finishEx(ex, "ok"); }
      else if (!result.msg) result.msg = "No es esa. Mira con ls -l / ls -i en el terminal y vuelve a intentarlo.";
      return result;
    }

    var snap = this.snapshot();
    var accepted = [ex.sol].concat(ACCEPT[ex.id] || []);
    var ci = os === "ps";
    var exactCmd = accepted.some(function (a) { var x = PRnorm(cmd), y = PRnorm(a.replace(/^\$ /, "")); return ci ? x.toLowerCase() === y.toLowerCase() : x === y; });

    // 1) normas de formato del examen
    if (exam && !hasSig && !NOSIGIL[ex.id]) {
      result.msg = "Formato del examen: la respuesta empieza por «" + sig + "» (con un espacio después). Ejemplo: " + sig + "ls -l";
      result.kind = "format"; return result;
    }
    // 2) ejecutar en el terminal real
    var userRes = this.shell.run(cmd, false);
    result.res = userRes;
    var userState = canon(this.shell), userOut = plain(userRes);

    // 3) referencia sobre copia del estado previo
    var ref = this.clone(); ref.st = JSON.parse(snap); ref.fs = new VFS(ref.st.fs, os === "ps");
    var refRes = this.runRef(ref, ex);
    var refState = canon(ref), refOut = plain(refRes);

    if (exactCmd) {
      result.ok = true; result.kind = "exact"; result.msg = "¡Correcto! Es exactamente la solución del profe.";
      if (ALT[ex.id]) { this.restore(snap); this.shell.run(ALT[ex.id], true); result.msg += " (Ojo: así se guardó en la plataforma, pero en un shell real da error; lo que funciona de verdad es: " + sig + ALT[ex.id] + ")"; }
    } else if (!exam || os === "ps") {
      var refErr = hasError(refRes);
      if (!refErr && userState === refState && userOut === refOut) { result.ok = true; result.kind = "equiv"; result.msg = "¡Funciona igual! Pero la solución del profe es: " + sig + ex.sol + (os === "ps" ? ". En PowerShell el corrector suele aceptar variantes, pero lo seguro es escribir la misma." : ". En el examen se compara el texto, así que mejor escríbela así."); }
    }
    if (!result.ok) {
      // estado restaurado para poder reintentar
      this.restore(snap);
      if (exam) {
        var refErr2 = hasError(refRes);
        if (!refErr2 && userState === refState && userOut === refOut) result.msg = "El comando hace lo mismo, pero en el examen la respuesta se compara como texto. Debía ser: " + sig + ex.sol;
        else result.msg = "Incorrecto.";
      } else result.msg = hasError(userRes) ? "Ese comando da error. Lee el mensaje del terminal y prueba otra vez." : "Se ejecuta, pero no hace lo que pide el enunciado. Prueba otra vez.";
      result.kind = "wrong";
      return result;
    }
    this.finishEx(ex, "ok");
    return result;
  };
  function PRnorm(s) { return s.trim().replace(/\s+/g, " ").replace(/'/g, "\"").replace(/\\\\/g, "\\"); }

  PR.finishEx = function (ex, r) {
    var tries = this.attempts[ex.id] || 1;
    this.results[ex.id] = (r === "ok" && tries === 1 && !this.hints) ? "first" : r;
    this.idx++; this.hints = 0;
  };

  PR.hint = function () {
    var ex = this.current(); if (!ex) return "";
    this.hints++;
    var words = ex.sol.split(/\s+/);
    if (this.hints === 1) { return ex.note ? "Ojo: " + ex.note : ex.concept ? "Es una respuesta corta (una palabra o un número). Mira el resultado en el terminal." : "Empieza por: " + words[0]; }
    if (this.hints === 2) return ex.concept ? "Pista: " + ex.sol.replace(/./g, "•") : "Forma: " + words.map(function (w, i) { return i === 0 ? w : w.replace(/[A-Za-z0-9_áéíóú]/g, "•"); }).join(" ");
    return "Solución: " + (ex.concept ? "" : this.sigil()) + ex.sol;
  };

  PR.score = function () {
    var r = this.results, first = 0, ok = 0, skip = 0;
    Object.keys(r).forEach(function (k) { if (r[k] === "first") first++; else if (r[k] === "ok") ok++; else skip++; });
    return { first: first, ok: ok, skip: skip, total: this.items.length, done: first + ok + skip };
  };

  /* guardar / restaurar progreso (se repite la solucion de lo hecho para reconstruir el estado) */
  PR.save = function () {
    try { localStorage.setItem("prog-" + this.os + "-" + this.serie.id, JSON.stringify({ results: this.results, idx: this.idx })); } catch (e) { }
  };
  PR.load = function () {
    var raw; try { raw = localStorage.getItem("prog-" + this.os + "-" + this.serie.id); } catch (e) { return false; }
    if (!raw) return false;
    try {
      var d = JSON.parse(raw); this.reset();
      for (var i = 0; i < d.idx && i < this.items.length; i++) this.runRef(this.shell, this.items[i]);
      this.idx = Math.min(d.idx, this.items.length); this.results = d.results || {}; return true;
    } catch (e) { return false; }
  };
  Sim.progressOf = function (os, serieId) {
    try { var d = JSON.parse(localStorage.getItem("prog-" + os + "-" + serieId) || "null"); return d ? d : null; } catch (e) { return null; }
  };

  Sim.newShell = newShell;
  Sim.canon = canon; Sim.plainOut = plain;
})(typeof window !== "undefined" ? window : globalThis);
