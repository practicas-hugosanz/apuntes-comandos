/* Simulador de shell Linux (bash en castellano, estilo LliureX).
   Soporta tuberias, redirecciones, comodines, comillas y ~50 comandos. */
(function (g) {
  "use strict";
  var Sim = g.Sim = g.Sim || {};
  var VFS = g.VFS;

  /* ---------------------------------------------------------- utilidades */
  var MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  var MESL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var DIA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  var DIAL = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  function pad(n, w, c) { return String(n).padStart(w || 2, c === undefined ? "0" : c); }
  Sim.MES = MES; Sim.MESL = MESL;

  Sim.strftime = function (fmt, d) {
    var map = {
      Y: function () { return d.getFullYear(); }, y: function () { return pad(d.getFullYear() % 100); },
      m: function () { return pad(d.getMonth() + 1); }, d: function () { return pad(d.getDate()); }, e: function () { return pad(d.getDate(), 2, " "); },
      H: function () { return pad(d.getHours()); }, M: function () { return pad(d.getMinutes()); }, S: function () { return pad(d.getSeconds()); },
      I: function () { return pad(d.getHours() % 12 || 12); }, p: function () { return d.getHours() < 12 ? "AM" : "PM"; },
      B: function () { return MESL[d.getMonth()]; }, b: function () { return MES[d.getMonth()]; }, h: function () { return MES[d.getMonth()]; },
      A: function () { return DIAL[d.getDay()]; }, a: function () { return DIA[d.getDay()]; },
      j: function () { return pad(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5), 3); },
      u: function () { return d.getDay() || 7; }, w: function () { return d.getDay(); },
      Z: function () { return "CET"; }, z: function () { return "+0100"; }, s: function () { return Math.floor(d.getTime() / 1000); },
      F: function () { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); },
      T: function () { return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); },
      D: function () { return pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + "/" + pad(d.getFullYear() % 100); },
      R: function () { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }, n: function () { return "\n"; }, t: function () { return "\t"; }, "%": function () { return "%"; }
    };
    return fmt.replace(/%([a-zA-Z%])/g, function (m, c) { return map[c] ? map[c]() : m; });
  };

  var ES = { ENOENT: "No existe el fichero o el directorio", EEXIST: "El fichero ya existe", ENOTDIR: "No es un directorio", EISDIR: "Es un directorio", ENOTEMPTY: "El directorio no está vacío", EPERM: "Operación no permitida", EACCES: "Permiso denegado", EINVAL: "Argumento inválido", EBUSY: "Dispositivo o recurso ocupado", ELOOP: "Demasiados niveles de enlaces simbólicos" };
  Sim.ES = ES;

  /* parser de opciones. flags: letras sin argumento; withArg: letras con argumento */
  function parseOpts(args, flags, withArg, longs) {
    var o = { _: {} }, a = [], i = 0, onlyOps = false;
    function setv(k, v) { o[k] = v; (o._[k] = o._[k] || []).push(v); }
    for (; i < args.length; i++) {
      var s = args[i];
      if (onlyOps || s === "-" || s.charAt(0) !== "-" || s.length < 2) { a.push(s); continue; }
      if (s === "--") { onlyOps = true; continue; }
      if (s.slice(0, 2) === "--") {
        var nm = s.slice(2), val = true, eq = nm.indexOf("=");
        if (eq >= 0) { val = nm.slice(eq + 1); nm = nm.slice(0, eq); }
        var m = longs && longs[nm];
        if (m === undefined) { o.bad = s; return o; }
        if (m.charAt && m.charAt(0) === ":") { // largo con argumento
          var key = m.slice(1);
          if (val === true) { val = args[++i]; if (val === undefined) { o.missing = s; return o; } }
          setv(key, val);
        } else setv(m, true);
        continue;
      }
      // numerico tipo -5 (head/tail)
      if (/^-\d+$/.test(s) && withArg.indexOf("#") >= 0) { setv("n", s.slice(1)); continue; }
      for (var j = 1; j < s.length; j++) {
        var ch = s.charAt(j);
        if (withArg.indexOf(ch) >= 0) {
          var v = s.slice(j + 1);
          if (v === "") { v = args[++i]; if (v === undefined) { o.missing = ch; return o; } }
          setv(ch, v); break;
        } else if (flags.indexOf(ch) >= 0) setv(ch, true);
        else { o.bad = "-" + ch; return o; }
      }
    }
    o.ops = a; return o;
  }
  Sim.parseOpts = parseOpts;

  function humanSize(n, sep) {
    if (n < 1024) return String(n);
    var units = ["K", "M", "G", "T"], v = n, k = -1;
    while (v >= 1024 && k < 3) { v /= 1024; k++; }
    var r = v < 10 ? (Math.ceil(v * 10) / 10) : Math.ceil(v);
    return (r % 1 ? String(r).replace(".", ",") : r + (v < 10 ? ",0" : "")) + units[k];
  }
  Sim.humanSize = humanSize;

  function modeStr(n) {
    var t = n.type === "d" ? "d" : n.type === "l" ? "l" : n.dev ? n.dev : "-";
    var m = n.mode, s = t, i;
    var bits = "rwxrwxrwx";
    for (i = 0; i < 9; i++) s += (m & (256 >> i)) ? bits.charAt(i) : "-";
    return s;
  }
  Sim.modeStr = modeStr;

  var C = { reset: "\x1b[0m", dir: "\x1b[01;34m", link: "\x1b[01;36m", exe: "\x1b[01;32m", red: "\x1b[01;31m", mag: "\x1b[35m", cyan: "\x1b[36m", dim: "\x1b[90m", green: "\x1b[01;32m", rev: "\x1b[7m", norm: "\x1b[27m", gz: "\x1b[01;31m" };
  Sim.C = C;
  function colorName(name, n, tty) {
    if (!tty) return name;
    if (n.type === "d") return C.dir + name + C.reset;
    if (n.type === "l") return C.link + name + C.reset;
    if (n.dev) return "\x1b[40;33;01m" + name + C.reset;
    if (/\.(gz|zip|tar)$/.test(name)) return C.gz + name + C.reset;
    if (n.mode & 73) return C.exe + name + C.reset;
    return name;
  }

  /* ---------------------------------------------------------- estado inicial */
  function inodeNo(n) { return 393216 + n.id * 7; }

  Sim.newLinuxState = function () {
    var fs = VFS.create(), v = new VFS(fs, false), root = "/";
    ["bin", "boot", "dev", "etc", "home", "lib", "media", "mnt", "opt", "proc", "root", "run", "sbin", "srv", "sys", "tmp", "usr", "var", "etc/apt", "usr/bin", "usr/lib", "usr/local", "usr/share", "usr/include", "usr/sbin", "usr/games", "usr/src", "var/log", "var/lib", "var/cache", "var/www", "var/tmp", "home/lliurex", "tmp/.X11-unix"].forEach(function (d) { v.mkdir("/" + d, root, true, 493); });
    function f(p, c, mode) { v.writeFile(p, root, c, false, mode === undefined ? 420 : mode); }
    f("/etc/hostname", "lliurex-VirtualBox\n");
    f("/etc/passwd", "root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nbin:x:2:2:bin:/bin:/usr/sbin/nologin\nsys:x:3:3:sys:/dev:/usr/sbin/nologin\nsync:x:4:65534:sync:/bin:/bin/sync\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\nmysql:x:114:124:MySQL Server,,,:/nonexistent:/bin/false\nsshd:x:110:65534::/run/sshd:/usr/sbin/nologin\nlliurex:x:1000:1000:lliurex,,,:/home/lliurex:/bin/bash\n");
    f("/etc/os-release", 'NAME="LliureX"\nVERSION="21"\nID=ubuntu\n');
    f("/etc/fstab", "UUID=1a2b3c4d / ext4 errors=remount-ro 0 1\n");
    f("/var/log/syslog", "ene  8 12:22:01 lliurex-VirtualBox systemd[1]: Started Session 1 of user lliurex.\n");
    f("/tmp/sesion.tmp", "");
    f("/usr/bin/tree", "#!ELF", 493); f("/usr/bin/htop", "#!ELF", 493);
    ["tty", "tty0", "tty1", "tty2", "tty3", "tty4", "tty5", "tty6", "tty7", "tty8", "tty9", "tty10", "tty20", "tty30", "ttyS0", "ttyS1", "ttyS2", "ttyS6", "tpm0", "tpmrm0", "console", "null", "zero", "random", "urandom", "full", "mem", "kmsg", "ptmx", "stdin", "stdout", "stderr", "fd", "loop0", "loop1", "sda", "sda1", "sda2", "sr0", "snd", "input", "usb"].forEach(function (n) {
      v.writeFile("/dev/" + n, root, "", false, /^(sda|sr0|loop)/.test(n) ? 432 : 438);
      var node = v.stat("/dev/" + n, root); node.dev = /^(sda|sr0|loop)/.test(n) ? "b" : "c";
    });
    // propietario root fuera de /home/lliurex y /tmp
    var setOwner = function (id, u) { var n = fs.inodes[id]; n.u = u; n.g = u === "root" ? "root" : u; if (n.type === "d") Object.keys(n.entries).forEach(function (k) { setOwner(n.entries[k], u); }); };
    setOwner(1, "root");
    var h = v.resolve("/home/lliurex", "/").id; setOwner(h, "lliurex");
    var t = v.resolve("/tmp", "/").id; fs.inodes[t].mode = 1023; fs.inodes[v.resolve("/tmp/sesion.tmp", "/").id].u = "lliurex";
    ["Escritorio", "Documentos", "Descargas", "Imágenes", "Música", "Plantillas", "Público", "Vídeos"].forEach(function (d) { v.mkdir("/home/lliurex/" + d, root, false, 509); });
    f("/home/lliurex/.bashrc", "# ~/.bashrc\n", 420); fs.inodes[v.resolve("/home/lliurex/.bashrc", "/").id].u = "lliurex";
    // /dev/tty* pertenecen a root:tty
    return {
      kind: "linux", fs: fs, cwd: "/home/lliurex", oldpwd: "/home/lliurex", hist: [], status: 0, nextPid: 4101, vars: {},
      installed: { tree: true, htop: true },
      procs: [
        { pid: 1, user: "root", cpu: 0.0, mem: 0.4, vsz: 169364, rss: 11876, tty: "?", stat: "Ss", start: "12:22", time: "0:03", cmd: "/sbin/init splash" },
        { pid: 612, user: "root", cpu: 0.1, mem: 0.5, vsz: 468980, rss: 17240, tty: "?", stat: "Ssl", start: "12:22", time: "0:08", cmd: "/usr/sbin/NetworkManager --no-daemon" },
        { pid: 701, user: "root", cpu: 0.0, mem: 0.1, vsz: 12172, rss: 7388, tty: "?", stat: "Ss", start: "12:22", time: "0:00", cmd: "sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups" },
        { pid: 815, user: "mysql", cpu: 1.2, mem: 8.3, vsz: 1819232, rss: 654128, tty: "?", stat: "Ssl", start: "12:22", time: "0:42", cmd: "/usr/sbin/mysqld" },
        { pid: 1020, user: "root", cpu: 2.4, mem: 2.1, vsz: 1256500, rss: 168392, tty: "tty7", stat: "Ssl+", start: "12:22", time: "1:15", cmd: "/usr/lib/xorg/Xorg -core :0 -seat seat0" },
        { pid: 1450, user: "lliurex", cpu: 0.2, mem: 0.3, vsz: 1124140, rss: 25012, tty: "?", stat: "S<sl", start: "12:23", time: "0:05", cmd: "/usr/bin/pulseaudio --daemonize=no" },
        { pid: 1234, user: "lliurex", cpu: 3.1, mem: 6.4, vsz: 3481944, rss: 512340, tty: "?", stat: "Sl", start: "12:30", time: "2:21", cmd: "/usr/lib/firefox/firefox -new-window" },
        { pid: 2210, user: "lliurex", cpu: 6.2, mem: 9.8, vsz: 1227340, rss: 790812, tty: "?", stat: "Sl", start: "13:02", time: "4:10", cmd: "/opt/google/chrome/chrome" },
        { pid: 2231, user: "lliurex", cpu: 4.1, mem: 5.7, vsz: 1199672, rss: 458120, tty: "?", stat: "Sl", start: "13:02", time: "2:36", cmd: "/opt/google/chrome/chrome --type=renderer" },
        { pid: 2275, user: "lliurex", cpu: 1.9, mem: 3.0, vsz: 1022564, rss: 241388, tty: "?", stat: "Sl", start: "13:02", time: "1:02", cmd: "/opt/google/chrome/chrome --type=gpu-process" },
        { pid: 2310, user: "lliurex", cpu: 0.0, mem: 0.1, vsz: 21500, rss: 5224, tty: "pts/0", stat: "Ss", start: "14:30", time: "0:00", cmd: "bash" }
      ]
    };
  };

  /* ---------------------------------------------------------- shell */
  function LinuxShell(st) { this.st = st; this.fs = new VFS(st.fs, false); }
  Sim.LinuxShell = LinuxShell;
  var LP = LinuxShell.prototype;

  LP.promptInfo = function () {
    var p = this.st.cwd, home = "/home/lliurex";
    if (p === home) p = "~"; else if (p.indexOf(home + "/") === 0) p = "~" + p.slice(home.length);
    return { user: "lliurex", host: "lliurex-VirtualBox", path: p, text: "lliurex@lliurex-VirtualBox:" + p + "$ " };
  };

  /* ---- tokenizador ---- */
  function findClose(s, i) { // s[i] == '(' tras '$'
    var d = 0;
    for (var j = i; j < s.length; j++) { var c = s[j]; if (c === "(") d++; else if (c === ")") { d--; if (d === 0) return j; } else if (c === "'" ) { var k = s.indexOf("'", j + 1); if (k > 0) j = k; } }
    return -1;
  }
  function tokenize(line) {
    var toks = [], cur = null, i = 0, n = line.length;
    function push() { if (cur) { toks.push({ t: "w", segs: cur }); cur = null; } }
    function add(seg) { (cur = cur || []).push(seg); }
    var ops = ["&&", "||", ">>", "2>>", "2>", "&>", ">&", "|", ";", ">", "<"];
    while (i < n) {
      var c = line.charAt(i);
      if (c === " " || c === "\t") { push(); i++; continue; }
      if (c === "#" && !cur) break;
      if (c === "\\") { if (i + 1 < n) add({ s: line.charAt(i + 1), q: "e" }); i += 2; continue; }
      if (c === "'") { var j = line.indexOf("'", i + 1); if (j < 0) return { err: "comilla simple sin cerrar" }; add({ s: line.slice(i + 1, j), q: "s" }); i = j + 1; continue; }
      if (c === '"') {
        var buf = "", k = i + 1, closed = false;
        while (k < n) {
          var d = line.charAt(k);
          if (d === '"') { closed = true; break; }
          if (d === "\\" && k + 1 < n && '"\\$`'.indexOf(line.charAt(k + 1)) >= 0) { buf += "\\" + line.charAt(k + 1); k += 2; continue; }
          if (d === "$" && line.charAt(k + 1) === "(") { var e = findClose(line, k + 1); if (e < 0) return { err: "falta )" }; if (buf) add({ s: buf, q: "d" }); buf = ""; add({ sub: line.slice(k + 2, e), q: "d" }); k = e + 1; continue; }
          buf += d; k++;
        }
        if (!closed) return { err: "comilla doble sin cerrar" };
        add({ s: buf, q: "d", dq: true }); if (!buf) { /* "" vacio cuenta como palabra */ }
        i = k + 1; continue;
      }
      if (c === "$" && line.charAt(i + 1) === "(") { var e2 = findClose(line, i + 1); if (e2 < 0) return { err: "falta )" }; add({ sub: line.slice(i + 2, e2), q: "n" }); i = e2 + 1; continue; }
      if (c === "`") { var e3 = line.indexOf("`", i + 1); if (e3 < 0) return { err: "falta `" }; add({ sub: line.slice(i + 1, e3), q: "n" }); i = e3 + 1; continue; }
      // operadores
      var op = null;
      if (c === "2" && cur && cur.length === 1 && cur[0].s === "2" && cur[0].q === "n" && line.charAt(i + 1) === ">") { cur = null; op = line.slice(i + 1, i + 3) === ">>" ? "2>>" : "2>"; toks.push({ t: "op", v: op }); i += op.length - 1; continue; }
      for (var oi = 0; oi < ops.length; oi++) { if (line.substr(i, ops[oi].length) === ops[oi] && ops[oi].charAt(0) !== "2") { op = ops[oi]; break; } }
      if (op) {
        push();
        if (op === ">&" && /^\d/.test(line.charAt(i + 2))) { op = ">&" + line.charAt(i + 2); }
        if (op === "2>" || op === "2>>") { /* ya tratado */ }
        toks.push({ t: "op", v: op }); i += op.length; continue;
      }
      add({ s: c, q: "n" }); i++;
    }
    push();
    return { toks: toks };
  }

  function expandBraces(s) {
    var m = /^(.*?)\{([^{}]*)\}(.*)$/.exec(s);
    if (!m) return [s];
    var body = m[2], items;
    var r = /^(-?\d+)\.\.(-?\d+)$/.exec(body), r2 = /^([a-zA-Z])\.\.([a-zA-Z])$/.exec(body);
    if (r) { var a = +r[1], b = +r[2]; items = []; if (a <= b) for (var x = a; x <= b; x++) items.push(String(x)); else for (var y = a; y >= b; y--) items.push(String(y)); }
    else if (r2) { var ca = r2[1].charCodeAt(0), cb = r2[2].charCodeAt(0); items = []; for (var z = ca; z <= cb; z++) items.push(String.fromCharCode(z)); }
    else if (body.indexOf(",") >= 0) items = body.split(",");
    else return [s];
    var out = [];
    items.forEach(function (it) { expandBraces(m[1] + it + m[3]).forEach(function (x) { out.push(x); }); });
    return out;
  }

  LP.expandVars = function (s) {
    var self = this, vars = this.st.vars;
    return s.replace(/\\([\\$`"])/g, "\u0001$1").replace(/\$(\{(\w+|\?)\}|(\w+|\?))/g, function (m, a, b, c) {
      var name = b || c;
      if (name === "?") return String(self.st.status);
      if (name === "HOME") return "/home/lliurex"; if (name === "USER" || name === "LOGNAME") return "lliurex"; if (name === "PWD") return self.st.cwd;
      if (name === "HOSTNAME") return "lliurex-VirtualBox"; if (name === "SHELL") return "/bin/bash"; if (name === "OLDPWD") return self.st.oldpwd;
      if (name === "PATH") return "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
      return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : "";
    }).replace(/\u0001/g, "");
  };

  /* convierte una palabra en lista de argumentos (variables, ~, llaves, comodines) */
  LP.expandWord = function (tok) {
    var self = this, val = "", pat = "", allN = true;
    tok.segs.forEach(function (sg, idx) {
      var text;
      if (sg.sub !== undefined) { var r = self.capture(sg.sub); text = r.replace(/\n+$/, ""); allN = false; val += text; pat += sg.q === "n" ? text : text.replace(/[*?\[\\]/g, "\\$&"); return; }
      if (sg.q === "s" || sg.q === "e") { allN = false; val += sg.s; pat += sg.s.replace(/[*?\[\\]/g, "\\$&"); return; }
      text = self.expandVars(sg.s);
      if (sg.q === "n" && idx === 0 && text.charAt(0) === "~" && (text.length === 1 || text.charAt(1) === "/")) text = "/home/lliurex" + text.slice(1);
      if (sg.q === "d") { allN = false; text = text.replace(/\\([\\$`"])/g, "$1"); val += text; pat += text.replace(/[*?\[\\]/g, "\\$&"); }
      else { val += text; pat += text; }
    });
    var words = [];
    if (allN && /\{.*\}/.test(val)) words = expandBraces(val).map(function (w) { return { v: w, p: w }; });
    else words = [{ v: val, p: pat }];
    var out = [];
    words.forEach(function (w) {
      if (VFS.hasGlob(w.p)) {
        var m = self.fs.glob(w.p, self.st.cwd);
        if (m.length) { m.forEach(function (x) { out.push(x); }); return; }
      }
      out.push(w.v.replace(/\\(.)/g, function (mm, ch) { return w.p === w.v ? ch : mm; }));
    });
    // un "" vacio entre comillas sigue siendo un argumento
    if (!out.length && tok.segs.some(function (s) { return s.q === "d" || s.q === "s"; })) out.push("");
    if (out.length === 1 && out[0] === "" && !tok.segs.some(function (s) { return s.q === "d" || s.q === "s"; }) && tok.segs.every(function (s) { return s.sub === undefined; })) return [];
    return out;
  };

  LP.capture = function (line) {
    var saved = this._cap; var r = this.run(line, true);
    this._cap = saved; return r.text.map(function (x) { return x.e ? "" : x.s; }).join("");
  };

  /* ---- ejecucion ---- */
  LP.exec = function (line) {
    var res = this.run(line, false);
    this.st.status = res.status;
    return res;
  };

  LP.run = function (line, quiet) {
    var res = { text: [], clear: false, status: 0 };
    var self = this;
    if (!quiet && line.trim()) this.st.hist.push(line);
    var tk = tokenize(line);
    if (tk.err) { res.text.push({ e: true, s: "bash: error sintáctico: " + tk.err + "\n" }); res.status = 2; return res; }
    var toks = tk.toks;
    // dividir en listas por ; && ||
    var lists = [], curL = [], sep = ";";
    toks.forEach(function (t) {
      if (t.t === "op" && (t.v === ";" || t.v === "&&" || t.v === "||")) { lists.push({ toks: curL, op: sep }); curL = []; sep = t.v; }
      else curL.push(t);
    });
    lists.push({ toks: curL, op: sep });
    var status = this.st.status;
    for (var li = 0; li < lists.length; li++) {
      var L = lists[li];
      if (L.op === "&&" && status !== 0) continue;
      if (L.op === "||" && status === 0) continue;
      if (!L.toks.length) { if (li < lists.length - 1 || L.op !== ";") { if (L.toks.length === 0 && (li > 0 || lists.length > 1) && toks.length) { res.text.push({ e: true, s: "bash: error sintáctico cerca del elemento inesperado «" + (L.op === ";" ? ";" : L.op) + "»\n" }); status = 2; break; } } continue; }
      // pipeline
      var cmds = [[]];
      L.toks.forEach(function (t) { if (t.t === "op" && t.v === "|") cmds.push([]); else cmds[cmds.length - 1].push(t); });
      if (cmds.some(function (c) { return !c.length; })) { res.text.push({ e: true, s: "bash: error sintáctico cerca del elemento inesperado «|»\n" }); status = 2; break; }
      status = this.runPipeline(cmds, res);
      this.st.status = status;
    }
    res.status = status;
    return res;
  };

  LP.runPipeline = function (cmds, res) {
    var self = this, stdin = null, status = 0;
    for (var ci = 0; ci < cmds.length; ci++) {
      var last = ci === cmds.length - 1;
      var words = [], redirs = [], t = cmds[ci], k;
      for (k = 0; k < t.length; k++) {
        var tok = t[k];
        if (tok.t === "op") {
          if (tok.v === "|" ) continue;
          var tgt = t[k + 1];
          if (/^>&\d$/.test(tok.v)) { redirs.push({ op: tok.v }); continue; }
          if (!tgt || tgt.t !== "w") { res.text.push({ e: true, s: "bash: error sintáctico cerca del elemento inesperado «newline»\n" }); return 2; }
          var tv = this.expandWord(tgt); k++;
          redirs.push({ op: tok.v, target: tv[0] });
        } else words = words.concat(this.expandWord(tok));
      }
      // asignaciones VAR=valor
      while (words.length && /^[A-Za-z_]\w*=/.test(words[0]) ) {
        var eq = words[0].indexOf("="); this.st.vars[words[0].slice(0, eq)] = words[0].slice(eq + 1); words.shift();
      }
      if (!words.length) { status = 0; continue; }
      var outRedir = null, errRedir = null, errToOut = false, inFile = null;
      redirs.forEach(function (r) {
        if (r.op === ">" || r.op === ">>" || r.op === "&>") outRedir = r;
        if (r.op === "2>" || r.op === "2>>") errRedir = r;
        if (r.op === "&>") errRedir = r;
        if (r.op === ">&2") { /* stdout a stderr */ }
        if (r.op === "<") inFile = r;
      });
      redirs.forEach(function (r) { if (r.op === ">&1" || r.op === "2>&1") errToOut = true; });
      if (redirs.some(function (r) { return r.op === ">&1"; })) errToOut = true;
      if (inFile) { var rf = this.fs.readFile(inFile.target, this.st.cwd); if (rf.err) { res.text.push({ e: true, s: "bash: " + inFile.target + ": " + ES[rf.err] + "\n" }); return 1; } stdin = rf.data; }
      var ctx = { args: words.slice(1), name: words[0], stdin: stdin, tty: last && !outRedir, o: "", er: "", root: false, sh: this, pipeNext: !last ? cmds[ci + 1] : null, pipeRest: cmds.slice(ci + 1) };
      var code = this.runCommand(ctx);
      status = code;
      var outText = ctx.o, errText = ctx.er;
      if (errToOut) { outText += errText; errText = ""; }
      if (errRedir) { if (!/^\/dev\/null$/.test(errRedir.target)) this.fs.writeFile(errRedir.target, this.st.cwd, errText, errRedir.op === "2>>"); errText = ""; }
      if (errText) res.text.push({ e: true, s: errText });
      if (outRedir) {
        if (outRedir.target === "/dev/null") { /* descartar */ }
        else {
          var pre = this.fs.resolve(outRedir.target, this.st.cwd);
          var denied = pre.id !== null && !this.canWrite(this.fs.node(pre.id));
          var er = denied ? "EACCES" : this.fs.writeFile(outRedir.target, this.st.cwd, outText, outRedir.op === ">>");
          if (er) { res.text.push({ e: true, s: "bash: " + outRedir.target + ": " + ES[er] + "\n" }); status = 1; }
        }
        stdin = "";
      } else if (!last) stdin = outText;
      else if (outText) res.text.push({ e: false, s: outText });
      if (ctx.clear) res.clear = true;
    }
    return status;
  };

  LP.canWrite = function (n) { var own = (n.u || "lliurex") === "lliurex"; return own ? !!(n.mode & 128) : !!(n.mode & 2); };
  LP.canRead = function (n) { var own = (n.u || "lliurex") === "lliurex"; return own ? !!(n.mode & 256) : !!(n.mode & 4); };
  LP.canExec = function (n) { var own = (n.u || "lliurex") === "lliurex"; return own ? !!(n.mode & 64) : !!(n.mode & 1); };

  LP.runCommand = function (ctx) {
    var name = ctx.name, self = this;
    if (name === "sudo") {
      var a = ctx.args.slice(); while (a[0] && a[0].charAt(0) === "-" && a[0] !== "-") a.shift();
      if (!a.length) { ctx.er += "uso: sudo [-AbEHnPS] orden\n"; return 1; }
      ctx.name = a[0]; ctx.args = a.slice(1); ctx.root = true; return this.runCommand(ctx);
    }
    if (name.indexOf("/") >= 0) {
      var r = this.fs.resolve(name, this.st.cwd);
      if (r.id === null) { ctx.er += "bash: " + name + ": " + ES.ENOENT + "\n"; return 127; }
      var nd = this.fs.node(r.id);
      if (nd.type === "d") { ctx.er += "bash: " + name + ": Es un directorio\n"; return 126; }
      if (!this.canExec(nd)) { ctx.er += "bash: " + name + ": Permiso denegado\n"; return 126; }
      var outAll = ""; (nd.content || "").split("\n").forEach(function (ln) { if (!ln.trim() || ln.charAt(0) === "#") return; var rr = self.run(ln, true); rr.text.forEach(function (x) { if (x.e) ctx.er += x.s; else outAll += x.s; }); });
      ctx.o += outAll; return 0;
    }
    var fn = CMDS[name];
    if (!fn || (name === "tree" && !this.st.installed.tree) || (name === "htop" && !this.st.installed.htop)) {
      ctx.er += "Command '" + name + "' not found" + (name === "tree" || name === "htop" ? ", but can be installed with:\n\nsudo apt install " + name + "\n" : "\n");
      ctx.er = ctx.er.replace(/^Command '([^']*)' not found\n$/, "bash: $1: orden no encontrada\n").replace(/^Command '(\w+)' not found, but can be installed with:/, "bash: $1: orden no encontrada\nOrden «$1» no encontrada, pero se puede instalar con:");
      return 127;
    }
    var code = fn.call(this, ctx);
    return code || 0;
  };

  /* ---------------------------------------------------------- helpers de comandos */
  function err(ctx, cmd, path, code) { ctx.er += cmd + ": " + path + ": " + (ES[code] || code) + "\n"; }

  function readInput(sh, ctx, cmd, files) { // devuelve [{name,data}] o null si hubo error
    var out = [], ok = true;
    if (!files.length) return [{ name: "(entrada estándar)", data: ctx.stdin === null ? "" : ctx.stdin, stdin: true }];
    files.forEach(function (f) {
      if (f === "-") { out.push({ name: "-", data: ctx.stdin || "" }); return; }
      var r = sh.fs.readFile(f, sh.st.cwd);
      if (r.err) { err(ctx, cmd, f, r.err); ok = false; return; }
      if (!sh.canRead(r.node)) { err(ctx, cmd, f, "EACCES"); ok = false; return; }
      out.push({ name: f, data: r.data });
    });
    out.failed = !ok; return out;
  }
  function lines(s) { if (s === "") return []; var a = s.split("\n"); if (a[a.length - 1] === "") a.pop(); return a; }
  function nl(arr) { return arr.length ? arr.join("\n") + "\n" : ""; }

  function badOpt(ctx, cmd, o) {
    if (o.bad) { ctx.er += cmd + ": opción inválida -- '" + o.bad.replace(/^-+/, "") + "'\nPruebe '" + cmd + " --help' para más información.\n"; return 2; }
    if (o.missing) { ctx.er += cmd + ": la opción requiere un argumento -- '" + o.missing.replace(/^-+/, "") + "'\n"; return 2; }
    return 0;
  }

  /* ---------------------------------------------------------- comandos */
  var CMDS = {};
  Sim.LINUX_CMDS = CMDS;

  CMDS.pwd = function (ctx) { ctx.o += this.st.cwd + "\n"; };
  CMDS.whoami = function (ctx) { ctx.o += (ctx.root ? "root" : "lliurex") + "\n"; };
  CMDS.hostname = function (ctx) { ctx.o += "lliurex-VirtualBox\n"; };
  CMDS.id = function (ctx) { ctx.o += "uid=1000(lliurex) gid=1000(lliurex) grupos=1000(lliurex),4(adm),24(cdrom),27(sudo),30(dip),46(plugdev)\n"; };
  CMDS.clear = function (ctx) { ctx.clear = true; };
  CMDS.history = function (ctx) { var h = this.st.hist; h.forEach(function (l, i) { ctx.o += String(i + 1).padStart(5) + "  " + l + "\n"; }); };
  CMDS.exit = function (ctx) { ctx.o += "(en el simulador no hay sesión que cerrar)\n"; };
  CMDS.export = function (ctx) { var self = this; ctx.args.forEach(function (a) { var e = a.indexOf("="); if (e > 0) self.st.vars[a.slice(0, e)] = a.slice(e + 1); }); };
  CMDS.true = function () { return 0; }; CMDS.false = function () { return 1; };
  CMDS.sleep = function () { return 0; };

  CMDS.cd = function (ctx) {
    var a = ctx.args[0], st = this.st;
    if (a === undefined || a === "~") a = "/home/lliurex";
    else if (a === "-") { a = st.oldpwd; ctx.o += a + "\n"; }
    else if (a.slice(0, 2) === "~/") a = "/home/lliurex" + a.slice(1);
    if (ctx.args.length > 1) { ctx.er += "bash: cd: demasiados argumentos\n"; return 1; }
    var r = this.fs.resolve(a, st.cwd);
    if (r.id === null) { ctx.er += "bash: cd: " + ctx.args[0] + ": " + ES[r.err] + "\n"; return 1; }
    var n = this.fs.node(r.id);
    if (n.type !== "d") { ctx.er += "bash: cd: " + ctx.args[0] + ": No es un directorio\n"; return 1; }
    if (!this.canExec(n)) { ctx.er += "bash: cd: " + ctx.args[0] + ": Permiso denegado\n"; return 1; }
    st.oldpwd = st.cwd; st.cwd = r.abs;
  };

  CMDS.echo = function (ctx) {
    var a = ctx.args, nonl = false, esc = false;
    while (a.length && /^-[neE]+$/.test(a[0])) { if (a[0].indexOf("n") > 0) nonl = true; if (a[0].indexOf("e") > 0) esc = true; a = a.slice(1); }
    var s = a.join(" ");
    if (esc) s = s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\\\/g, "\\");
    ctx.o += s + (nonl ? "" : "\n");
  };

  CMDS.mkdir = function (ctx) {
    var o = parseOpts(ctx.args, "pv", "m", { parents: "p", verbose: "v" }), b = badOpt(ctx, "mkdir", o); if (b) return b;
    if (!o.ops.length) { ctx.er += "mkdir: falta un operando\nPruebe 'mkdir --help' para más información.\n"; return 1; }
    var st = 0, self = this;
    o.ops.forEach(function (p) {
      var e = self.fs.mkdir(p, self.st.cwd, !!o.p);
      if (e) { ctx.er += "mkdir: no se puede crear el directorio «" + p + "»: " + ES[e] + "\n"; st = 1; }
      else if (o.v) ctx.o += "mkdir: creado el directorio '" + p + "'\n";
    });
    return st;
  };
  CMDS.rmdir = function (ctx) {
    var o = parseOpts(ctx.args, "p", "", {}), b = badOpt(ctx, "rmdir", o); if (b) return b;
    if (!o.ops.length) { ctx.er += "rmdir: falta un operando\n"; return 1; }
    var st = 0, self = this;
    o.ops.forEach(function (p) { var e = self.fs.rmdir(p, self.st.cwd); if (e) { ctx.er += "rmdir: fallo al borrar '" + p + "': " + ES[e] + "\n"; st = 1; } });
    return st;
  };
  CMDS.touch = function (ctx) {
    var o = parseOpts(ctx.args, "ac", "", {}), b = badOpt(ctx, "touch", o); if (b) return b;
    if (!o.ops.length) { ctx.er += "touch: falta un operando fichero\nPruebe 'touch --help' para más información.\n"; return 1; }
    var st = 0, self = this;
    o.ops.forEach(function (p) {
      var r = self.fs.resolve(p, self.st.cwd);
      if (r.id !== null) { self.fs.touchTime(self.fs.node(r.id)); return; }
      var e = self.fs.writeFile(p, self.st.cwd, "", false);
      if (e) { ctx.er += "touch: no se puede efectuar «touch» sobre '" + p + "': " + ES[e] + "\n"; st = 1; }
    });
    return st;
  };

  CMDS.rm = function (ctx) {
    var o = parseOpts(ctx.args, "rRfidv", "", { recursive: "r", force: "f", verbose: "v", dir: "d" }), b = badOpt(ctx, "rm", o); if (b) return b;
    if (!o.ops.length) { if (o.f) return 0; ctx.er += "rm: falta un operando\nPruebe 'rm --help' para más información.\n"; return 1; }
    var st = 0, self = this, rec = o.r || o.R;
    o.ops.forEach(function (p) {
      var r = self.fs.resolve(p, self.st.cwd, false);
      if (r.id === null) { if (!o.f) { ctx.er += "rm: no se puede borrar '" + p + "': " + ES.ENOENT + "\n"; st = 1; } return; }
      var n = self.fs.node(r.id);
      if (n.type === "d" && !rec) { if (o.d) { var e1 = self.fs.rmdir(p, self.st.cwd); if (e1) { ctx.er += "rm: no se puede borrar '" + p + "': " + ES[e1] + "\n"; st = 1; } return; } ctx.er += "rm: no se puede borrar '" + p + "': Es un directorio\n"; st = 1; return; }
      if (r.abs === "/" || r.name === "." || r.name === "..") { ctx.er += "rm: no se puede borrar '" + p + "'\n"; st = 1; return; }
      var e = n.type === "d" ? self.fs.removeTree(p, self.st.cwd) : self.fs.unlink(p, self.st.cwd);
      if (e) { ctx.er += "rm: no se puede borrar '" + p + "': " + ES[e] + "\n"; st = 1; }
      else if (o.v) ctx.o += (n.type === "d" ? "se borra el directorio '" : "se borra '") + p + "'\n";
    });
    return st;
  };

  CMDS.cp = function (ctx) {
    var o = parseOpts(ctx.args, "rRfivpa", "", { recursive: "r", force: "f", verbose: "v" }), b = badOpt(ctx, "cp", o); if (b) return b;
    var a = o.ops, self = this, rec = o.r || o.R || o.a;
    if (a.length < 2) { ctx.er += a.length ? "cp: falta el fichero de destino tras '" + a[0] + "'\nPruebe 'cp --help' para más información.\n" : "cp: falta un fichero como argumento\nPruebe 'cp --help' para más información.\n"; return 1; }
    var dst = a[a.length - 1], srcs = a.slice(0, -1), st = 0;
    var dr = this.fs.resolve(dst, this.st.cwd), dstIsDir = dr.id !== null && this.fs.node(dr.id).type === "d";
    if (srcs.length > 1 && !dstIsDir) { ctx.er += "cp: el objetivo '" + dst + "' no es un directorio\n"; return 1; }
    srcs.forEach(function (s) {
      var e = self.fs.copy(s, dst, self.st.cwd, rec);
      if (e === "ENOENT") { ctx.er += "cp: no se puede efectuar `stat' sobre '" + s + "': " + ES.ENOENT + "\n"; st = 1; }
      else if (e === "ENOTR") { ctx.er += "cp: -r no especificado; se omite el directorio '" + s + "'\n"; st = 1; }
      else if (e === "SAME") { ctx.er += "cp: '" + s + "' y '" + dst + "' son el mismo fichero\n"; st = 1; }
      else if (e === "EINVAL") { ctx.er += "cp: no se puede copiar un directorio, '" + s + "', dentro de sí mismo, '" + dst + "'\n"; st = 1; }
      else if (e) { ctx.er += "cp: no se puede crear el fichero '" + dst + "': " + ES[e] + "\n"; st = 1; }
      else if (o.v) ctx.o += "'" + s + "' -> '" + dst + "'\n";
    });
    return st;
  };
  CMDS.mv = function (ctx) {
    var o = parseOpts(ctx.args, "fiv", "", {}), b = badOpt(ctx, "mv", o); if (b) return b;
    var a = o.ops, self = this;
    if (a.length < 2) { ctx.er += a.length ? "mv: falta el fichero de destino tras '" + a[0] + "'\nPruebe 'mv --help' para más información.\n" : "mv: falta un fichero como argumento\nPruebe 'mv --help' para más información.\n"; return 1; }
    var dst = a[a.length - 1], srcs = a.slice(0, -1), st = 0;
    var dr = this.fs.resolve(dst, this.st.cwd), dstIsDir = dr.id !== null && this.fs.node(dr.id).type === "d";
    if (srcs.length > 1 && !dstIsDir) { ctx.er += "mv: el objetivo '" + dst + "' no es un directorio\n"; return 1; }
    srcs.forEach(function (s) {
      var e = self.fs.rename(s, dst, self.st.cwd);
      if (e === "ENOENT") { ctx.er += "mv: no se puede efectuar `stat' sobre '" + s + "': " + ES.ENOENT + "\n"; st = 1; }
      else if (e === "SAME") { ctx.er += "mv: '" + s + "' y '" + dst + "' son el mismo fichero\n"; st = 1; }
      else if (e === "EINVAL") { ctx.er += "mv: no se puede mover '" + s + "' a un subdirectorio de sí mismo, '" + dst + "/" + s + "'\n"; st = 1; }
      else if (e) { ctx.er += "mv: no se puede mover '" + s + "' a '" + dst + "': " + ES[e] + "\n"; st = 1; }
      else if (o.v) ctx.o += "se renombra '" + s + "' -> '" + dst + "'\n";
    });
    return st;
  };

  CMDS.ln = function (ctx) {
    var o = parseOpts(ctx.args, "sfv", "", { symbolic: "s", force: "f" }), b = badOpt(ctx, "ln", o); if (b) return b;
    var a = o.ops;
    if (a.length < 1) { ctx.er += "ln: falta un fichero como argumento\nPruebe 'ln --help' para más información.\n"; return 1; }
    if (a.length === 1) a = [a[0], "."];
    var e;
    if (o.s) e = this.fs.symlink(a[0], a[1], this.st.cwd); else e = this.fs.link(a[0], a[1], this.st.cwd);
    if (e === "ENOENT" && !o.s) { ctx.er += "ln: no se pudo crear el enlace duro '" + a[1] + "' => '" + a[0] + "': " + ES.ENOENT + "\n"; return 1; }
    if (e === "EEXIST") { ctx.er += "ln: fallo al crear el " + (o.s ? "enlace simbólico" : "enlace duro") + " '" + a[1] + "': " + ES.EEXIST + "\n"; return 1; }
    if (e === "EPERM") { ctx.er += "ln: '" + a[0] + "': no se permite el enlace duro para el directorio\n"; return 1; }
    if (e) { ctx.er += "ln: fallo al crear el enlace '" + a[1] + "': " + ES[e] + "\n"; return 1; }
  };

  CMDS.cat = function (ctx) {
    var o = parseOpts(ctx.args, "nbAsE", "", { number: "n" }), b = badOpt(ctx, "cat", o); if (b) return b;
    var inp = readInput(this, ctx, "cat", o.ops), n = 0, self = this;
    inp.forEach(function (f) {
      var r = self.fs.resolve(f.name, self.st.cwd);
      if (!f.stdin && r.id !== null && self.fs.node(r.id).type === "d") { ctx.er += "cat: " + f.name + ": Es un directorio\n"; return; }
      var ls = lines(f.data);
      if (o.n) ls = ls.map(function (l) { return String(++n).padStart(6) + "\t" + l; });
      ctx.o += nl(ls) + (f.data !== "" && f.data.slice(-1) !== "\n" && !o.n ? "" : "");
      if (f.data !== "" && f.data.slice(-1) !== "\n") ctx.o = ctx.o.replace(/\n$/, "");
    });
    return inp.failed ? 1 : 0;
  };

  CMDS.head = function (ctx) { return headTail.call(this, ctx, "head"); };
  CMDS.tail = function (ctx) { return headTail.call(this, ctx, "tail"); };
  function headTail(ctx, which) {
    var o = parseOpts(ctx.args, "qv", "nc#", { lines: ":n", bytes: ":c" }), b = badOpt(ctx, which, o); if (b) return b;
    var spec = o.n !== undefined ? String(o.n) : "10", plus = spec.charAt(0) === "+";
    if (o.n !== undefined && !/^[+-]?\d+$/.test(spec)) { ctx.er += which + ": " + spec + ": número de líneas inválido\n"; return 1; }
    var k = Math.abs(parseInt(spec, 10));
    var inp = readInput(this, ctx, which, o.ops), multi = inp.length > 1 && !o.q;
    inp.forEach(function (f, i) {
      if (multi || o.v) ctx.o += (i ? "\n" : "") + "==> " + f.name + " <==\n";
      if (o.c !== undefined) { var c = parseInt(o.c, 10); ctx.o += which === "head" ? f.data.slice(0, c) : f.data.slice(-c); return; }
      var ls = lines(f.data), pick;
      if (which === "head") pick = ls.slice(0, k);
      else pick = plus ? ls.slice(Math.max(k - 1, 0)) : (k === 0 ? [] : ls.slice(-k));
      ctx.o += nl(pick);
    });
    return inp.failed ? 1 : 0;
  }

  CMDS.wc = function (ctx) {
    var o = parseOpts(ctx.args, "lwcm", "", { lines: "l", words: "w", bytes: "c", chars: "m" }), b = badOpt(ctx, "wc", o); if (b) return b;
    var inp = readInput(this, ctx, "wc", o.ops), rows = [], tot = [0, 0, 0];
    var any = o.l || o.w || o.c || o.m, want = any ? [!!o.l, !!o.w, !!(o.c || o.m)] : [true, true, true];
    inp.forEach(function (f) {
      var d = f.data, c = [(d.match(/\n/g) || []).length, (d.trim() === "" ? 0 : d.trim().split(/\s+/).length), VFS.utf8len(d)];
      if (o.m && !o.c) c[2] = Array.from(d).length;
      c.forEach(function (x, i) { tot[i] += x; });
      rows.push({ c: c, name: f.stdin ? "" : f.name });
    });
    if (inp.length > 1) rows.push({ c: tot, name: "total" });
    var cnt = want.filter(Boolean).length, width = (cnt === 1 && inp.length === 1) ? 1 : String(Math.max.apply(null, tot.concat([0]))).length;
    if (!any && inp.length === 1 && inp[0].stdin) width = 7;
    if (inp.length === 1 && cnt > 1) width = Math.max(String(Math.max.apply(null, rows[0].c)).length, 1);
    rows.forEach(function (r) {
      var parts = []; r.c.forEach(function (x, i) { if (want[i]) parts.push(String(x).padStart(width)); });
      ctx.o += parts.join(" ") + (r.name ? " " + r.name : "") + "\n";
    });
    return inp.failed ? 1 : 0;
  };

  function breToJs(p, mode) { // mode: 'E' extendido, 'B' basico, 'F' fijo
    if (mode === "F") return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (mode === "E") return p;
    var out = "";
    for (var i = 0; i < p.length; i++) {
      var c = p.charAt(i);
      if (c === "\\" && i + 1 < p.length) { var d = p.charAt(++i); out += "|(){}+?".indexOf(d) >= 0 ? d : "\\" + d; }
      else if ("|(){}+?".indexOf(c) >= 0) out += "\\" + c;
      else out += c;
    }
    return out;
  }
  Sim.breToJs = breToJs;

  CMDS.grep = function (ctx) {
    var o = parseOpts(ctx.args, "vincEFlwxrRHhqsoL", "eA", { "ignore-case": "i", "invert-match": "v", count: "c", "line-number": "n", recursive: "r", color: "C", "extended-regexp": "E" }), b = badOpt(ctx, "grep", o); if (b) return b;
    var a = o.ops.slice(), pats = o._.e ? o._.e.slice() : [];
    if (!pats.length) { if (!a.length) { ctx.er += "Modo de empleo: grep [OPCIÓN]... PATRONES [FICHERO]...\nPruebe 'grep --help' para obtener más información.\n"; return 2; } pats = [a.shift()]; }
    var mode = o.F ? "F" : o.E ? "E" : "B";
    var src = pats.map(function (p) { return breToJs(p, mode); }).join("|");
    if (o.w) src = "\\b(?:" + src + ")\\b"; if (o.x) src = "^(?:" + src + ")$";
    var re;
    try { re = new RegExp(src, o.i ? "i" : ""); } catch (e) { ctx.er += "grep: Expresión regular inválida\n"; return 2; }
    var reG = new RegExp(src, o.i ? "gi" : "g"), self = this, files = a, rec = o.r || o.R;
    var list = [];
    if (rec) {
      var roots = files.length ? files : ["."];
      roots.forEach(function (rt) { walkFiles(self, rt, function (p) { list.push(p); }); });
      files = list.length ? list : files;
    }
    var inp = readInput(this, ctx, "grep", files), multi = (inp.length > 1 || rec) && !o.h, found = false, tty = ctx.tty;
    inp.forEach(function (f) {
      var ls = lines(f.data), cnt = 0, hit = false;
      ls.forEach(function (l, i) {
        var m = re.test(l); if (o.v) m = !m;
        if (!m) return;
        cnt++; hit = true; found = true;
        if (o.c || o.l || o.q) return;
        var shown = l;
        if (tty && !o.v) { reG.lastIndex = 0; shown = l.replace(reG, function (mm) { return mm === "" ? "" : C.red + mm + C.reset; }); }
        if (o.o) { reG.lastIndex = 0; var mm2, parts = []; while ((mm2 = reG.exec(l)) && mm2[0] !== "") parts.push(mm2[0]); parts.forEach(function (p2) { ctx.o += (multi ? f.name + ":" : "") + (o.n ? (i + 1) + ":" : "") + p2 + "\n"; }); return; }
        var pre = (multi ? (tty ? C.mag + f.name + C.reset + C.cyan + ":" + C.reset : f.name + ":") : "") + (o.n ? (tty ? C.green + (i + 1) + C.reset + C.cyan + ":" + C.reset : (i + 1) + ":") : "");
        ctx.o += pre + shown + "\n";
      });
      if (o.c) ctx.o += (multi ? f.name + ":" : "") + cnt + "\n";
      if (o.l && hit) ctx.o += f.name + "\n";
    });
    return inp.failed ? 2 : (found ? 0 : 1);
  };
  function walkFiles(sh, path, cb) {
    var r = sh.fs.resolve(path, sh.st.cwd);
    if (r.id === null) return;
    var n = sh.fs.node(r.id);
    if (n.type === "d") Object.keys(n.entries).sort(VFS.cmpName).forEach(function (k) { walkFiles(sh, (path === "/" ? "" : path.replace(/\/$/, "")) + "/" + k, cb); });
    else cb(path);
  }

  CMDS.find = function (ctx) {
    var a = ctx.args.slice(), starts = [], self = this;
    while (a.length && a[0].charAt(0) !== "-" && a[0] !== "!" && a[0] !== "(") starts.push(a.shift());
    if (!starts.length) starts = ["."];
    var f = { name: null, iname: null, type: null, maxd: Infinity, mind: 0, exec: null, del: false, empty: false, neg: false };
    for (var i = 0; i < a.length; i++) {
      var t = a[i];
      if (t === "-name") f.name = a[++i]; else if (t === "-iname") f.iname = a[++i];
      else if (t === "-type") f.type = a[++i]; else if (t === "-maxdepth") f.maxd = +a[++i]; else if (t === "-mindepth") f.mind = +a[++i];
      else if (t === "-empty") f.empty = true; else if (t === "-print") { /* por defecto */ } else if (t === "-delete") f.del = true;
      else if (t === "-exec") { var cmd = []; i++; while (i < a.length && a[i] !== ";" && a[i] !== "\\;" && a[i] !== "+") cmd.push(a[i++]); f.exec = cmd; }
      else { ctx.er += "find: predicado desconocido `" + t + "'\n"; return 1; }
    }
    var reN = f.name !== null ? VFS.globToRegex(f.name) : null, reI = f.iname !== null ? VFS.globToRegex(f.iname, true) : null, st = 0;
    function visit(path, disp, depth) {
      var r = self.fs.resolve(path, "/", false), n = self.fs.node(r.id), base = disp.replace(/\/+$/, "").split("/").pop() || disp;
      var ok = depth >= f.mind;
      if (reN && !reN.test(base)) ok = false; if (reI && !reI.test(base)) ok = false;
      if (f.type && ((f.type === "f" && n.type !== "f") || (f.type === "d" && n.type !== "d") || (f.type === "l" && n.type !== "l"))) ok = false;
      if (f.empty && !((n.type === "d" && !Object.keys(n.entries).length) || (n.type === "f" && !n.content))) ok = false;
      if (ok) {
        if (f.exec) { var line = f.exec.map(function (x) { return x === "{}" ? "'" + disp + "'" : x; }).join(" "); var rr = self.run(line, true); rr.text.forEach(function (x) { if (x.e) ctx.er += x.s; else ctx.o += x.s; }); }
        else if (f.del) { n.type === "d" ? self.fs.rmdir(path, "/") : self.fs.unlink(path, "/"); }
        else ctx.o += disp + "\n";
      }
      if (n.type === "d" && depth < f.maxd) Object.keys(n.entries).sort(VFS.cmpName).forEach(function (k) { visit((path === "/" ? "" : path) + "/" + k, (disp === "/" ? "" : disp) + "/" + k, depth + 1); });
    }
    starts.forEach(function (s) {
      var r = self.fs.resolve(s, self.st.cwd);
      if (r.id === null) { ctx.er += "find: '" + s + "': " + ES.ENOENT + "\n"; st = 1; return; }
      visit(r.abs, s, 0);
    });
    return st;
  };

  /* sort */
  function fieldsOf(line, sep) {
    if (sep) return line.split(sep);
    var res = [], re = /\s*\S+/g, m; while ((m = re.exec(line))) res.push(m[0]); return res;
  }
  CMDS.sort = function (ctx) {
    var o = parseOpts(ctx.args, "rnuifbhMc", "ktoT", { reverse: "r", numeric: "n", unique: "u", "field-separator": ":t", key: ":k", "ignore-case": "f" }), b = badOpt(ctx, "sort", o); if (b) return b;
    var keys = (o._.k || []).map(function (k) {
      var m = /^(\d+)(?:\.(\d+))?([a-zA-Z]*)(?:,(\d+)(?:\.(\d+))?([a-zA-Z]*))?$/.exec(k);
      if (!m) return null;
      var fl = (m[3] || "") + (m[6] || "");
      return { s: +m[1], e: m[4] ? +m[4] : null, n: /n/.test(fl) || /h/.test(fl), r: /r/.test(fl), f: /f/.test(fl) };
    });
    if (keys.some(function (k) { return !k; })) { ctx.er += "sort: falta un número de campo después de la opción '-k'\n"; return 2; }
    var sep = o.t === undefined ? null : o.t;
    if (sep === "\\t") sep = "\t";
    var inp = readInput(this, ctx, "sort", o.ops), all = [];
    inp.forEach(function (f) { all = all.concat(lines(f.data)); });
    function keyOf(line, k) {
      var fl = fieldsOf(line, sep), s = k.s - 1, e = k.e === null ? fl.length - 1 : k.e - 1;
      return fl.slice(s, e + 1).join(sep === null ? "" : sep);
    }
    function num(s) { var m = /^\s*([-+]?\d*[.,]?\d+)/.exec(s); return m ? parseFloat(m[1].replace(",", ".")) : 0; }
    function cmpStr(x, y, ci) { if (ci) { x = x.toLowerCase(); y = y.toLowerCase(); } return x.localeCompare(y, "es"); }
    var specs = keys.length ? keys : [{ s: 1, e: null, whole: true, n: !!o.n, r: false, f: !!o.f }];
    all = all.map(function (l, i) { return { l: l, i: i }; });
    all.sort(function (A, B) {
      for (var i = 0; i < specs.length; i++) {
        var k = specs[i], x = k.whole ? A.l : keyOf(A.l, k), y = k.whole ? B.l : keyOf(B.l, k), r;
        var useN = k.n || (o.n && !keys.length) || (o.n && keys.length && !/[a-z]/.test("")); useN = k.n || !!o.n;
        r = useN ? (num(x) - num(y)) : cmpStr(x, y, k.f || o.f || o.i);
        if (r !== 0) return (k.r || o.r) ? -r : r;
      }
      var r2 = A.l === B.l ? 0 : cmpStr(A.l, B.l, false) || (A.l < B.l ? -1 : 1);
      return o.r ? -r2 : r2;
    });
    var outL = all.map(function (x) { return x.l; });
    if (o.u) outL = outL.filter(function (l, i) { return i === 0 || l !== outL[i - 1]; });
    ctx.o += nl(outL);
    return inp.failed ? 2 : 0;
  };
  CMDS.uniq = function (ctx) {
    var o = parseOpts(ctx.args, "cdui", "", {}), b = badOpt(ctx, "uniq", o); if (b) return b;
    var inp = readInput(this, ctx, "uniq", o.ops.slice(0, 1)), ls = [], cur = null, n = 0;
    lines(inp[0].data).forEach(function (l) { if (cur !== null && l === cur) n++; else { if (cur !== null) ls.push([cur, n]); cur = l; n = 1; } });
    if (cur !== null) ls.push([cur, n]);
    ls.forEach(function (p) { if (o.d && p[1] < 2) return; if (o.u && p[1] > 1) return; ctx.o += (o.c ? String(p[1]).padStart(7) + " " : "") + p[0] + "\n"; });
  };

  function parseRanges(spec) {
    var out = [];
    spec.split(",").forEach(function (p) {
      var m = /^(\d*)-(\d*)$/.exec(p);
      if (m) out.push([m[1] ? +m[1] : 1, m[2] ? +m[2] : Infinity]);
      else if (/^\d+$/.test(p)) out.push([+p, +p]);
      else out.push(null);
    });
    return out.some(function (x) { return x === null; }) ? null : out;
  }
  CMDS.cut = function (ctx) {
    var o = parseOpts(ctx.args, "s", "dfcb", { delimiter: ":d", fields: ":f", characters: ":c", "only-delimited": "s" }), b = badOpt(ctx, "cut", o); if (b) return b;
    if (o.f === undefined && o.c === undefined && o.b === undefined) { ctx.er += "cut: debe especificar una lista de bytes, caracteres o campos\nPruebe 'cut --help' para más información.\n"; return 1; }
    var d = o.d === undefined ? "\t" : o.d;
    if (d.length !== 1) { ctx.er += "cut: el delimitador debe ser un solo carácter\nPruebe 'cut --help' para más información.\n"; return 1; }
    var rg = parseRanges(o.f !== undefined ? o.f : o.c !== undefined ? o.c : o.b);
    if (!rg) { ctx.er += "cut: lista de campos inválida\nPruebe 'cut --help' para más información.\n"; return 1; }
    var inp = readInput(this, ctx, "cut", o.ops);
    inp.forEach(function (f) {
      lines(f.data).forEach(function (l) {
        if (o.f !== undefined) {
          if (l.indexOf(d) < 0) { if (!o.s) ctx.o += l + "\n"; return; }
          var parts = l.split(d), sel = [];
          parts.forEach(function (p, i) { if (rg.some(function (r) { return i + 1 >= r[0] && i + 1 <= r[1]; })) sel.push(p); });
          ctx.o += sel.join(d) + "\n";
        } else {
          var chars = Array.from(l), sel2 = "";
          chars.forEach(function (ch, i) { if (rg.some(function (r) { return i + 1 >= r[0] && i + 1 <= r[1]; })) sel2 += ch; });
          ctx.o += sel2 + "\n";
        }
      });
    });
    return inp.failed ? 1 : 0;
  };

  function trSet(s) {
    var out = [], i = 0;
    var classes = { "[:upper:]": "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "[:lower:]": "abcdefghijklmnopqrstuvwxyz", "[:digit:]": "0123456789", "[:space:]": " \t\n\r\f\v", "[:alpha:]": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", "[:alnum:]": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "[:punct:]": "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~" };
    while (i < s.length) {
      var c = s.charAt(i), cl = null;
      if (c === "[" && s.charAt(i + 1) === ":") { var e = s.indexOf(":]", i); if (e > 0) { cl = classes[s.slice(i, e + 2)]; if (cl) { cl.split("").forEach(function (x) { out.push(x); }); i = e + 2; continue; } } }
      if (c === "\\" && i + 1 < s.length) { var n = s.charAt(i + 1); var map = { t: "\t", n: "\n", r: "\r", "\\": "\\" }; c = map[n] !== undefined ? map[n] : n; i += 2; }
      else i++;
      if (s.charAt(i) === "-" && i + 1 < s.length) {
        var hi = s.charAt(i + 1), j = i + 2;
        if (hi === "\\" && i + 2 < s.length) { var m2 = { t: "\t", n: "\n" }; hi = m2[s.charAt(i + 2)] || s.charAt(i + 2); j = i + 3; }
        for (var x = c.charCodeAt(0); x <= hi.charCodeAt(0); x++) out.push(String.fromCharCode(x));
        i = j; continue;
      }
      out.push(c);
    }
    return out;
  }
  CMDS.tr = function (ctx) {
    var o = parseOpts(ctx.args, "dsc", "", { delete: "d", squeeze: "s" }), b = badOpt(ctx, "tr", o); if (b) return b;
    var a = o.ops;
    if (!a.length) { ctx.er += "tr: falta un operando\nPruebe 'tr --help' para más información.\n"; return 1; }
    if (!o.d && !o.s && a.length < 2) { ctx.er += "tr: falta un operando tras '" + a[0] + "'\nSolo se da una cadena para la traducción.\nPruebe 'tr --help' para más información.\n"; return 1; }
    if (a.length > 2) { ctx.er += "tr: operando extra '" + a[2] + "'\nPruebe 'tr --help' para más información.\n"; return 1; }
    var s1 = trSet(a[0]), s2 = a[1] !== undefined ? trSet(a[1]) : [];
    var data = ctx.stdin === null ? "" : ctx.stdin, out = "";
    if (ctx.stdin === null) { ctx.o = ""; return 0; }
    var set1 = {}; s1.forEach(function (c) { set1[c] = true; });
    var inSet = function (c) { return o.c ? !set1[c] : !!set1[c]; };
    var map = {};
    if (!o.d && s2.length) s1.forEach(function (c, i) { map[c] = s2[Math.min(i, s2.length - 1)]; });
    var prev = null;
    Array.from(data).forEach(function (c) {
      if (o.d) { if (inSet(c)) return; out += c; prev = null; return; }
      var ch = c;
      if (s2.length) { if (inSet(c)) ch = o.c ? s2[s2.length - 1] : map[c]; }
      if (o.s) { var sq = s2.length ? s2 : s1; var inSq = s2.length ? (sq.indexOf(ch) >= 0) : inSet(c); if (inSq && prev === ch) return; prev = ch; } else prev = null;
      out += ch;
    });
    ctx.o += out;
  };

  CMDS.gzip = function (ctx) {
    var o = parseOpts(ctx.args, "kdcfv19", "", { keep: "k", decompress: "d", stdout: "c" }), b = badOpt(ctx, "gzip", o); if (b) return b;
    if (!o.ops.length) { ctx.er += "gzip: la entrada comprimida no se puede leer de un terminal\n"; return 1; }
    var self = this, st = 0;
    o.ops.forEach(function (p) {
      var r = self.fs.resolve(p, self.st.cwd);
      if (r.id === null) { ctx.er += "gzip: " + p + ": " + ES.ENOENT + "\n"; st = 1; return; }
      var n = self.fs.node(r.id);
      if (n.type === "d") { ctx.er += "gzip: " + p + " es un directorio -- se ignora\n"; st = 1; return; }
      if (o.d) {
        if (!/\.gz$/.test(p)) { ctx.er += "gzip: " + p + ": sufijo desconocido -- se ignora\n"; st = 1; return; }
        if (!n.gz) { ctx.er += "gzip: " + p + ": no está en formato gzip\n"; st = 1; return; }
        var tgt = p.replace(/\.gz$/, "");
        if (self.fs.exists(tgt, self.st.cwd)) { ctx.er += "gzip: " + tgt + " ya existe; no se sobreescribe\n"; st = 1; return; }
        self.fs.writeFile(tgt, self.st.cwd, n.content, false, n.mode);
        if (!o.k) self.fs.unlink(p, self.st.cwd);
      } else {
        if (n.gz || /\.gz$/.test(p)) { ctx.er += "gzip: " + p + " ya tiene el sufijo .gz -- se ignora\n"; st = 1; return; }
        var gzp = p + ".gz";
        if (self.fs.exists(gzp, self.st.cwd)) { ctx.er += "gzip: " + gzp + " ya existe; no se sobreescribe\n"; st = 1; return; }
        var sz = Math.max(30, Math.round(VFS.utf8len(n.content) * 0.45) + 24);
        self.fs.writeFile(gzp, self.st.cwd, n.content, false, n.mode);
        var gn = self.fs.stat(gzp, self.st.cwd); gn.gz = true; gn.size = sz;
        if (!o.k) self.fs.unlink(p, self.st.cwd);
      }
    });
    return st;
  };
  CMDS.gunzip = function (ctx) { ctx.args = ["-d"].concat(ctx.args); return CMDS.gzip.call(this, ctx); };
  CMDS.zcat = function (ctx) { var self = this; ctx.args.forEach(function (p) { var r = self.fs.resolve(p, self.st.cwd); if (r.id !== null) ctx.o += self.fs.node(r.id).content; else ctx.er += "zcat: " + p + ": " + ES.ENOENT + "\n"; }); };

  /* chmod */
  CMDS.chmod = function (ctx) {
    var o = parseOpts(ctx.args.filter(function (x, i) { return !(i === 0 && /^[-+=ugoa]/.test(x) && /^-[rwxXst]+$/.test(x)); }), "Rvc", "", { recursive: "R" });
    if (o.bad) { // p.ej. chmod -w fichero
      var raw = ctx.args; o = { a: raw.slice(), _: {} };
    }
    var a = o.ops;
    if (!a.length) { ctx.er += "chmod: falta un operando\nPruebe 'chmod --help' para más información.\n"; return 1; }
    if (a.length < 2) { ctx.er += "chmod: falta un operando después de «" + a[0] + "»\nPruebe 'chmod --help' para más información.\n"; return 1; }
    var spec = a[0], files = a.slice(1), self = this, st = 0;
    function apply(old) {
      if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8) & 511;
      var m = old & 511, clauses = spec.split(",");
      for (var ci = 0; ci < clauses.length; ci++) {
        var cm = /^([ugoa]*)((?:[-+=][rwxXst]*)+)$/.exec(clauses[ci]);
        if (!cm) return null;
        var who = cm[1] || "a", mask = 0;
        if (who.indexOf("a") >= 0) who = "ugo";
        var opRe = /([-+=])([rwxXst]*)/g, om;
        while ((om = opRe.exec(cm[2]))) {
          var bits = 0;
          if (om[2].indexOf("r") >= 0) bits |= 4; if (om[2].indexOf("w") >= 0) bits |= 2; if (om[2].indexOf("x") >= 0 || om[2].indexOf("X") >= 0) bits |= 1;
          var wmask = 0, wbits = 0;
          if (who.indexOf("u") >= 0) { wmask |= 448; wbits |= bits << 6; }
          if (who.indexOf("g") >= 0) { wmask |= 56; wbits |= bits << 3; }
          if (who.indexOf("o") >= 0) { wmask |= 7; wbits |= bits; }
          if (om[1] === "+") m |= wbits; else if (om[1] === "-") m &= ~wbits; else m = (m & ~wmask) | wbits;
        }
      }
      return m & 511;
    }
    if (!/^[0-7]{1,4}$/.test(spec) && apply(0) === null) { ctx.er += "chmod: modo inválido: «" + spec + "»\nPruebe 'chmod --help' para más información.\n"; return 1; }
    function doOne(p, rec) {
      var r = self.fs.resolve(p, self.st.cwd);
      if (r.id === null) { ctx.er += "chmod: no se puede acceder a '" + p + "': " + ES.ENOENT + "\n"; st = 1; return; }
      var n = self.fs.node(r.id); n.mode = apply(n.mode);
      if (rec && n.type === "d") Object.keys(n.entries).forEach(function (k) { doOne(r.abs + "/" + k, true); });
    }
    files.forEach(function (p) { doOne(p, o.R); });
    return st;
  };

  /* ls */
  CMDS.ls = function (ctx) {
    var o = parseOpts(ctx.args, "laAiRhdF1tSrfsGn", "", { all: "a", "almost-all": "A", "human-readable": "h", recursive: "R", directory: "d", color: "G", inode: "i" }), b = badOpt(ctx, "ls", o); if (b) return b;
    var self = this, fs = this.fs, tty = ctx.tty && !o.f;
    var targets = o.ops.length ? o.ops : ["."], st = 0;
    var files = [], dirs = [];
    targets.forEach(function (t) {
      var r = fs.resolve(t, self.st.cwd, !!o.l ? (o.d ? false : true) : true);
      if (r.id === null) { ctx.er += "ls: no se puede acceder a '" + t + "': " + ES[r.err || "ENOENT"] + "\n"; st = 2; return; }
      var n = fs.node(r.id);
      if (n.type === "d" && !o.d) dirs.push({ arg: t, abs: r.abs, node: n }); else files.push({ name: t, node: n });
    });
    var multi = targets.length > 1 || o.R, first = true;
    function entryInfo(name, n) { return { name: name, node: n }; }
    function fmtLong(list, showTotal) {
      var rows = list.map(function (e) {
        var n = e.node, own = n.u || "lliurex", grp = n.g || own;
        var size = n.dev ? (n.dev === "b" ? "8, 0" : "4, 0") : (o.h ? humanSize(fs.size(n)) : String(fs.size(n)));
        var d = new Date(n.m);
        var date = MES[d.getMonth()] + " " + pad(d.getDate(), 2, " ") + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
        var nm = colorName(e.name, n, tty) + (n.type === "l" ? " -> " + n.target : "");
        return { ino: inodeNo(n), mode: modeStr(n), nl: n.nlink, own: own, grp: grp, size: size, date: date, nm: nm };
      });
      var w = { nl: 0, own: 0, grp: 0, size: 0, ino: 0 };
      rows.forEach(function (r) { w.nl = Math.max(w.nl, String(r.nl).length); w.own = Math.max(w.own, r.own.length); w.grp = Math.max(w.grp, r.grp.length); w.size = Math.max(w.size, r.size.length); w.ino = Math.max(w.ino, String(r.ino).length); });
      var s = "";
      if (showTotal) { var blocks = 0; list.forEach(function (e) { var n = e.node; if (n.type === "d") blocks += 4; else if (n.type === "f") { var sz = fs.size(n); blocks += sz ? Math.ceil(sz / 4096) * 4 : 0; } }); s += "total " + blocks + "\n"; }
      rows.forEach(function (r) {
        s += (o.i ? String(r.ino).padStart(w.ino) + " " : "") + r.mode + " " + String(r.nl).padStart(w.nl) + " " + r.own.padEnd(w.own) + " " + r.grp.padEnd(w.grp) + " " + r.size.padStart(w.size) + " " + r.date + " " + r.nm + "\n";
      });
      return s;
    }
    function fmtShort(list) {
      var items = list.map(function (e) { return (o.i ? inodeNo(e.node) + " " : "") + colorName(e.name, e.node, tty) + (o.F ? (e.node.type === "d" ? "/" : e.node.type === "l" ? "@" : (e.node.mode & 73) ? "*" : "") : ""); });
      var plain = list.map(function (e) { return (o.i ? inodeNo(e.node) + " " : "") + e.name + (o.F ? (e.node.type === "d" ? "/" : "") : ""); });
      if (!tty || o["1"] || !items.length) return nl(items);
      var width = 100, maxLen = Math.max.apply(null, plain.map(function (x) { return Array.from(x).length; })) + 2;
      var cols = Math.max(1, Math.floor(width / maxLen)), rowsN = Math.ceil(items.length / cols), s = "";
      cols = Math.ceil(items.length / rowsN);
      for (var r = 0; r < rowsN; r++) {
        var line = "";
        for (var c = 0; c < cols; c++) {
          var idx = c * rowsN + r; if (idx >= items.length) break;
          var cellPlain = Array.from(plain[idx]).length;
          line += items[idx] + (c < cols - 1 && (c + 1) * rowsN + r < items.length ? " ".repeat(Math.max(2, maxLen - cellPlain)) : "");
        }
        s += line.replace(/\s+$/, "") + "\n";
      }
      return s;
    }
    function sortList(list) {
      var l = list.slice();
      l.sort(function (a, b) {
        if (o.S) return fs.size(b.node) - fs.size(a.node);
        if (o.t) return b.node.m - a.node.m;
        return VFS.cmpName(a.name, b.name);
      });
      if (o.r) l.reverse(); return l;
    }
    function listDir(d, label) {
      var names = Object.keys(d.node.entries), list = [];
      if (!self.canRead(d.node)) { ctx.er += "ls: no se puede abrir el directorio '" + d.arg + "': Permiso denegado\n"; st = 2; return; }
      if (o.a) { list.push(entryInfo(".", d.node)); var pr = fs.resolve(d.abs + "/..", "/"); list.push(entryInfo("..", fs.node(pr.id))); }
      names.forEach(function (nm) { if (nm.charAt(0) === "." && !o.a && !o.A) return; list.push(entryInfo(nm, fs.node(d.node.entries[nm]))); });
      list = sortList(list);
      if (label !== null) ctx.o += (first ? "" : "\n") + label + ":\n";
      first = false;
      ctx.o += o.l || o.n ? fmtLong(list, true) : fmtShort(list);
      if (o.R) names.slice().sort(VFS.cmpName).forEach(function (nm) {
        var ch = fs.node(d.node.entries[nm]);
        if (ch.type === "d" && (nm.charAt(0) !== "." || o.a || o.A)) listDir({ arg: label === "." ? "./" + nm : (label || d.arg) + "/" + nm, abs: d.abs + "/" + nm, node: ch }, label === "." ? "./" + nm : (label || d.arg) + "/" + nm);
      });
    }
    if (files.length) {
      files = sortList(files);
      ctx.o += o.l || o.n ? fmtLong(files, false) : fmtShort(files); first = false;
    }
    dirs.sort(function (a, b) { return VFS.cmpName(a.arg, b.arg); });
    dirs.forEach(function (d) { listDir(d, multi ? d.arg : null); });
    return st;
  };

  CMDS.tree = function (ctx) {
    var o = parseOpts(ctx.args, "adLfC", "L", {}), b = badOpt(ctx, "tree", o); if (b) return b;
    var self = this, targets = o.ops.length ? o.ops : ["."], dcount = 0, fcount = 0, tty = ctx.tty;
    targets.forEach(function (t) {
      var r = self.fs.resolve(t, self.st.cwd);
      if (r.id === null) { ctx.o += t + " [error opening dir]\n"; return; }
      var n = self.fs.node(r.id);
      ctx.o += colorName(t, n, tty) + "\n";
      if (n.type !== "d") { fcount++; return; }
      (function walk(node, prefix, depth) {
        if (o.L && depth >= +o.L) return;
        var names = Object.keys(node.entries).filter(function (k) { return o.a || k.charAt(0) !== "."; }).sort(VFS.cmpName);
        names.forEach(function (k, i) {
          var ch = self.fs.node(node.entries[k]), lastOne = i === names.length - 1;
          if (o.d && ch.type !== "d") return;
          ctx.o += prefix + (lastOne ? "└── " : "├── ") + colorName(k, ch, tty) + (ch.type === "l" ? " -> " + ch.target : "") + "\n";
          if (ch.type === "d") { dcount++; walk(ch, prefix + (lastOne ? "    " : "│   "), depth + 1); } else fcount++;
        });
      })(n, "", 0);
    });
    ctx.o += "\n" + dcount + " directorios" + (o.d ? "" : ", " + fcount + " ficheros") + "\n";
  };

  CMDS.stat = function (ctx) {
    var self = this;
    ctx.args.forEach(function (p) {
      var r = self.fs.resolve(p, self.st.cwd, false);
      if (r.id === null) { ctx.er += "stat: no se puede efectuar `stat' sobre '" + p + "': " + ES.ENOENT + "\n"; return; }
      var n = self.fs.node(r.id), d = new Date(n.m), ts = Sim.strftime("%Y-%m-%d %H:%M:%S.000000000 +0100", d);
      ctx.o += "  Fichero: " + p + (n.type === "l" ? " -> " + n.target : "") + "\n  Tamaño: " + self.fs.size(n) + "\tBloques: " + (n.type === "d" ? 8 : Math.ceil(self.fs.size(n) / 512)) + "\tbloque E/S: 4096   " + (n.type === "d" ? "directorio" : n.type === "l" ? "enlace simbólico" : "fichero regular") + "\n" +
        "Dispositivo: 801h/2049d\tInodo: " + inodeNo(n) + "\tEnlaces: " + n.nlink + "\nAcceso: (" + pad((n.mode).toString(8), 4) + "/" + modeStr(n) + ")  Uid: ( 1000/ lliurex)   Gid: ( 1000/ lliurex)\nModificación: " + ts + "\n";
    });
  };
  CMDS.file = function (ctx) {
    var self = this;
    ctx.args.forEach(function (p) { var r = self.fs.resolve(p, self.st.cwd, false); if (r.id === null) { ctx.o += p + ": cannot open `" + p + "' (No such file or directory)\n"; return; } var n = self.fs.node(r.id); ctx.o += p + ": " + (n.type === "d" ? "directory" : n.type === "l" ? "symbolic link to " + n.target : n.gz ? "gzip compressed data" : n.content === "" ? "empty" : "ASCII text") + "\n"; });
  };

  /* ---- informacion del sistema ---- */
  CMDS.uname = function (ctx) {
    var o = parseOpts(ctx.args, "asnrvmpio", "", { "kernel-name": "s", "kernel-release": "r", "machine": "m", "nodename": "n" }), b = badOpt(ctx, "uname", o); if (b) return b;
    var P = { s: "Linux", n: "lliurex-VirtualBox", r: "5.15.0-91-generic", v: "#101~20.04.1-Ubuntu SMP Thu Nov 16 14:22:28 UTC 2023", m: "x86_64", p: "x86_64", i: "x86_64", o: "GNU/Linux" };
    var order = ["s", "n", "r", "v", "m", "p", "i", "o"];
    if (o.a) { ctx.o += order.map(function (k) { return P[k]; }).join(" ") + "\n"; return; }
    var sel = order.filter(function (k) { return o[k]; });
    ctx.o += (sel.length ? sel : ["s"]).map(function (k) { return P[k]; }).join(" ") + "\n";
  };
  CMDS.lscpu = function (ctx) {
    ctx.o += "Arquitectura:                         x86_64\nModo(s) de operación de las CPU:      32-bit, 64-bit\nOrden de los bytes:                   Little Endian\nTamaños de las direcciones:           39 bits physical, 48 bits virtual\nCPU(s):                               4\nLista de la(s) CPU(s) en línea:       0-3\nHilo(s) de procesamiento por núcleo:  1\nNúcleo(s) por «socket»:               4\nSocket(s):                            1\nID de fabricante:                     GenuineIntel\nFamilia de CPU:                       6\nModelo:                               158\nNombre del modelo:                    Intel(R) Core(TM) i5-8500 CPU @ 3.00GHz\nCPU MHz:                              3000.000\nCPU MHz máx.:                         4100,0000\nCPU MHz mín.:                         800,0000\nVirtualización:                       VT-x\nCaché L1d:                            128 KiB\nCaché L2:                             1 MiB\nCaché L3:                             9 MiB\n";
  };
  CMDS.free = function (ctx) {
    var o = parseOpts(ctx.args, "hmgbktw", "s", { human: "h", mega: "m" }), b = badOpt(ctx, "free", o); if (b) return b;
    var kib = { total: 8062136, used: 2204312, free: 4093560, shared: 220416, cache: 1764264, avail: 5428340, st: 2097148, su: 0, sf: 2097148 };
    function f(v) {
      if (o.h) { var u = ["Ki", "Mi", "Gi"], x = v, i = 0; while (x >= 1024 && i < 2) { x /= 1024; i++; } return i === 0 ? v + "B" : (x < 10 ? x.toFixed(1).replace(".", ",") : Math.round(x).toString()) + u[i]; }
      if (o.m) return Math.round(v / 1024); if (o.g) return Math.round(v / 1048576); if (o.b) return v * 1024; return v;
    }
    var w = 12, hdr = ["total", "usado", "libre", "compartido", "búfer/caché", "disponible"];
    ctx.o += " ".repeat(7) + hdr.map(function (h) { return h.padStart(w); }).join("") + "\n";
    ctx.o += "Mem:   " + [kib.total, kib.used, kib.free, kib.shared, kib.cache, kib.avail].map(function (v) { return String(f(v)).padStart(w); }).join("") + "\n";
    ctx.o += "Inter: " + [kib.st, kib.su, kib.sf].map(function (v) { return String(f(v)).padStart(w); }).join("") + "\n";
  };
  CMDS.df = function (ctx) {
    var o = parseOpts(ctx.args, "hkTiP", "", { "human-readable": "h" }), b = badOpt(ctx, "df", o); if (b) return b;
    var rows = [["udev", 3977848, 0, 3977848, "/dev"], ["tmpfs", 806216, 1912, 804304, "/run"], ["/dev/sda1", 244529656, 52733400, 179300948, "/"], ["tmpfs", 4031064, 41240, 3989824, "/dev/shm"], ["tmpfs", 5120, 4, 5116, "/run/lock"], ["/dev/sda2", 98298500, 21458076, 71838424, "/home"], ["tmpfs", 806212, 76, 806136, "/run/user/1000"]];
    var self = this, sel = rows;
    if (o.ops.length) {
      sel = [];
      o.ops.forEach(function (p) {
        var r = self.fs.resolve(p, self.st.cwd);
        if (r.id === null) { ctx.er += "df: " + p + ": " + ES.ENOENT + "\n"; return; }
        var m = r.abs.indexOf("/home") === 0 ? rows[5] : rows[2]; sel.push(m);
      });
      if (!sel.length) return 1;
    }
    function f(v) { if (!o.h) return String(v); var x = v, u = ["K", "M", "G"], i = 0; while (x >= 1024 && i < 2) { x /= 1024; i++; } return (x < 10 ? x.toFixed(1).replace(".", ",") : String(Math.ceil(x))) + u[i]; }
    ctx.o += "S.ficheros      " + (o.h ? "Tamaño" : "bloques de 1K").padStart(o.h ? 6 : 14) + " Usados  Disp Uso% Montado en\n".replace("Usados  Disp", o.h ? "Usados  Disp" : "   Usados Disponible");
    sel.forEach(function (r) {
      var pct = Math.ceil(r[2] / (r[2] + r[3]) * 100) + "%";
      ctx.o += r[0].padEnd(15) + " " + f(r[1] + 0).padStart(o.h ? 6 : 14) + " " + f(r[2]).padStart(o.h ? 6 : 9) + " " + f(r[3]).padStart(o.h ? 5 : 10) + " " + pct.padStart(4) + " " + r[4] + "\n";
    });
  };
  CMDS.lsblk = function (ctx) {
    ctx.o += "NAME   MAJ:MIN RM   SIZE RO TYPE MOUNTPOINT\nloop0    7:0    0  61,9M  1 loop /snap/core20/1974\nloop1    7:1    0  63,3M  1 loop /snap/core20/2015\nsda      8:0    0 238,5G  0 disk \n├─sda1   8:1    0 140,0G  0 part /\n└─sda2   8:2    0  98,5G  0 part /home\nsr0     11:0    1  1024M  0 rom  \n";
  };
  CMDS.lspci = function (ctx) {
    ctx.o += "00:00.0 Host bridge: Intel Corporation 8th Gen Core Processor Host Bridge/DRAM Registers (rev 07)\n00:02.0 VGA compatible controller: Intel Corporation UHD Graphics 630 (Desktop)\n00:14.0 USB controller: Intel Corporation Cannon Lake PCH USB 3.1 xHCI Host Controller (rev 10)\n00:16.0 Communication controller: Intel Corporation Cannon Lake PCH HECI Controller (rev 10)\n00:17.0 SATA controller: Intel Corporation Cannon Lake PCH SATA AHCI Controller (rev 10)\n00:1b.0 Audio device: Intel Corporation Cannon Lake PCH cAVS (rev 10)\n00:1f.3 Audio device: Intel Corporation Cannon Lake PCH cAVS (rev 10)\n00:1f.6 Ethernet controller: Intel Corporation Ethernet Connection (7) I219-V (rev 10)\n";
  };
  CMDS.lsusb = function (ctx) {
    ctx.o += "Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub\nBus 001 Device 004: ID 046d:c077 Logitech, Inc. M105 Optical Mouse\nBus 001 Device 003: ID 04f2:0833 Chicony Electronics Co., Ltd KU-0833 Keyboard\nBus 001 Device 002: ID 0951:1666 Kingston Technology DataTraveler 100 G3/G4/SE9 G2\nBus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub\n";
  };
  CMDS.uptime = function (ctx) {
    var o = parseOpts(ctx.args, "ps", "", { pretty: "p", since: "s" }); if (o.p) { ctx.o += "up 2 hours, 13 minutes\n"; return; } if (o.s) { ctx.o += "2025-01-08 12:22:31\n"; return; }
    ctx.o += " 14:35:45 up  2:13,  1 usuario,  carga promedio: 0,52, 0,48, 0,45\n";
  };
  CMDS.who = function (ctx) {
    if (ctx.args.join(" ") === "am i" || ctx.args.join(" ") === "am I") { ctx.o += "lliurex  pts/0        2025-01-08 14:30 (:0)\n"; return; }
    ctx.o += "lliurex  tty7         2025-01-08 12:22 (:0)\n";
  };
  var KLOG = [
    [0.0, "Linux version 5.15.0-91-generic (buildd@lcy02-amd64-045) (gcc (Ubuntu 9.4.0-1ubuntu1~20.04.2) 9.4.0) #101~20.04.1-Ubuntu SMP"],
    [0.0, "Command line: BOOT_IMAGE=/boot/vmlinuz-5.15.0-91-generic root=UUID=1a2b3c4d ro quiet splash"],
    [0.0, "KERNEL supported cpus:"], [0.0, "  Intel GenuineIntel"],
    [0.0, "BIOS-provided physical RAM map:"],
    [0.0, "x86/fpu: Supporting XSAVE feature 0x001: 'x87 floating point registers'"],
    [0.001, "tsc: Detected 3000.000 MHz processor"],
    [0.2, "ACPI: Core revision 20210730"],
    [0.9, "NET: Registered PF_INET6 protocol family"],
    [1.4, "usb 1-2: new high-speed USB device number 2 using xhci_hcd"],
    [1.9, "sd 0:0:0:0: [sda] 500118192 512-byte logical blocks: (256 GB/238 GiB)"],
    [2.3, "EXT4-fs (sda1): mounted filesystem with ordered data mode. Opts: (null)"],
    [3.8, "e1000e 0000:00:1f.6 enp0s31f6: NIC Link is Up 1000 Mbps Full Duplex"],
    [4.2, "snd_hda_intel 0000:00:1f.3: bound 0000:00:02.0 (ops i915_audio_component_bind_ops)"]
  ];
  CMDS.dmesg = function (ctx) {
    var o = parseOpts(ctx.args, "HTwCkLx", "", { "human": "H" }), b = badOpt(ctx, "dmesg", o); if (b) return b;
    var prev = 0;
    KLOG.forEach(function (k, i) {
      var pre;
      if (o.H) { pre = i === 0 ? "[ene  8 12:22] " : "[  +" + (k[0] - prev).toFixed(6) + "] "; prev = k[0]; }
      else pre = "[" + k[0].toFixed(6).padStart(12) + "] ";
      ctx.o += pre + k[1] + "\n";
    });
  };
  CMDS.date = function (ctx) {
    var d = new Date(VFS.BASE_TIME), a = ctx.args.filter(function (x) { return x.charAt(0) !== "-" || x.charAt(1) === undefined || x === "-u"; });
    var fmt = null; a.forEach(function (x) { if (x.charAt(0) === "+") fmt = x.slice(1); });
    if (fmt !== null) { ctx.o += Sim.strftime(fmt, d) + "\n"; return; }
    ctx.o += Sim.strftime("%a %b %e %H:%M:%S CET %Y", d).replace(/(\w+) (\w+)  ?(\d)/, "$1 $2 $3").replace(/^(\S+) (\S+) (\d) /, "$1 $2  $3 ") + "\n";
    ctx.o = ctx.o.replace(/^(\S+) (\S+) +(\d+) /, function (m, x, y, z) { return x + " " + y + " " + z.padStart(2, " ") + " "; });
  };

  function calMonth(y, m, title, today, tty) {
    var out = [], first = new Date(y, m, 1), dim = new Date(y, m + 1, 0).getDate(), lead = (first.getDay() + 6) % 7;
    var tt = title === "" ? MESL[m] : MESL[m] + " " + y;
    var padL = Math.floor((20 - tt.length) / 2);
    out.push(" ".repeat(Math.max(0, padL)) + tt + " ".repeat(Math.max(0, 20 - padL - tt.length)));
    out.push("lu ma mi ju vi sá do");
    var row = "   ".repeat(lead);
    for (var d = 1; d <= dim; d++) {
      var cell = pad(d, 2, " ");
      if (today && today === d) cell = tty ? C.rev + cell + C.norm : cell;
      row += cell; if ((lead + d) % 7 === 0) { out.push(row); row = ""; } else row += " ";
    }
    if (row) out.push(row.replace(/ $/, ""));
    return out;
  }
  Sim.calMonth = calMonth;
  CMDS.cal = function (ctx) {
    var a = ctx.args.filter(function (x) { return x.charAt(0) !== "-"; }), now = new Date(VFS.BASE_TIME), tty = ctx.tty;
    var y = now.getFullYear(), m = now.getMonth(), isYear = false;
    if (a.length === 1) { var v = +a[0]; if (!/^\d+$/.test(a[0])) { ctx.er += "cal: no se puede interpretar «" + a[0] + "»\n"; return 1; } if (v >= 1 && v <= 12 && a[0].length <= 2) { m = v - 1; } else { y = v; isYear = true; } }
    else if (a.length === 2) { m = (+a[0]) - 1; y = +a[1]; if (!(m >= 0 && m < 12)) { ctx.er += "cal: valor de mes ilegal: use 1-12\n"; return 1; } }
    if (!(y >= 1 && y <= 9999)) { ctx.er += "cal: valor de año ilegal: use 1-9999\n"; return 1; }
    if (!isYear) { var isToday = y === now.getFullYear() && m === now.getMonth(); ctx.o += nl(calMonth(y, m, undefined, isToday ? now.getDate() : 0, tty).map(function (l) { return l.replace(/\s+$/, ""); })); return; }
    var title = String(y); ctx.o += " ".repeat(Math.floor((62 - title.length) / 2)) + title + "\n\n";
    for (var q = 0; q < 4; q++) {
      var cols = [0, 1, 2].map(function (c) { return calMonth(y, q * 3 + c, "", y === now.getFullYear() && q * 3 + c === now.getMonth() ? now.getDate() : 0, tty); });
      var h = 8;
      for (var r = 0; r < h; r++) {
        ctx.o += cols.map(function (cl) { var l = cl[r] || ""; var vis = l.replace(/\x1b\[[0-9;]*m/g, ""); return l + " ".repeat(20 - vis.length); }).join("  ").replace(/\s+$/, "") + "\n";
      }
      if (q < 3) ctx.o += "\n";
    }
  };

  CMDS.du = function (ctx) {
    var o = parseOpts(ctx.args, "shakcmxb", "d", { "human-readable": "h", summarize: "s", "all": "a" }), b = badOpt(ctx, "du", o); if (b) return b;
    var self = this, targets = o.ops.length ? o.ops : ["."], st = 0;
    function fmt(bytes) { return o.h ? humanSize(bytes).replace(/^(\d+)$/, "$1") : String(Math.ceil(bytes / 1024)); }
    targets.forEach(function (t) {
      var r = self.fs.resolve(t, self.st.cwd);
      if (r.id === null) { ctx.er += "du: no se puede acceder a '" + t + "': " + ES.ENOENT + "\n"; st = 1; return; }
      var rows = [];
      var total = self.fs.usage(r.id, function (rel, bytes, n) { rows.push({ rel: rel, bytes: bytes, n: n }); }, "");
      if (o.s) { ctx.o += fmt(total) + "\t" + t + "\n"; return; }
      rows.forEach(function (x) { if (x.n.type !== "d" && !o.a) return; ctx.o += fmt(x.bytes) + "\t" + (x.rel ? (t === "/" ? "" : t.replace(/\/$/, "")) + "/" + x.rel : t) + "\n"; });
    });
    return st;
  };

  /* procesos */
  CMDS.ps = function (ctx) {
    var a = ctx.args.slice(), sortKey = null, full = false, self = this;
    var si = a.findIndex(function (x) { return x === "--sort" || /^--sort=/.test(x); });
    if (si >= 0) { var v = a[si] === "--sort" ? a[si + 1] : a[si].slice(7); sortKey = v; a.splice(si, a[si] === "--sort" ? 2 : 1); if (v === undefined) { ctx.er += "error: la opción --sort requiere un argumento\n"; return 1; } }
    var flags = a.join(" ").replace(/-/g, ""); full = /aux|ef|u|e|f/.test(flags) && a.length > 0;
    var procs = this.st.procs.slice();
    // procesos propios del comando
    var me = { pid: this.st.nextPid, user: "lliurex", cpu: 0.0, mem: 0.0, vsz: 38412, rss: 3392, tty: "pts/0", stat: "R+", start: "14:35", time: "0:00", cmd: "ps " + ctx.args.join(" ") };
    procs.push(me);
    if (ctx.pipeNext && /^grep$/.test(ctx.pipeNext[0] && ctx.pipeNext[0].segs ? ctx.pipeNext[0].segs.map(function (s) { return s.s; }).join("") : "")) {
      var g = ctx.pipeNext.slice(1).map(function (t) { return t.t === "w" ? t.segs.map(function (s) { return s.s !== undefined ? s.s : ""; }).join("") : ""; }).join(" ");
      procs.push({ pid: this.st.nextPid + 1, user: "lliurex", cpu: 0.0, mem: 0.0, vsz: 17692, rss: 2540, tty: "pts/0", stat: "S+", start: "14:35", time: "0:00", cmd: "grep --color=auto " + g.replace(/"/g, "") });
    }
    if (/aux|ef|-e|-A|^-?au/.test(flags) || /a/.test(flags) && /x/.test(flags) || /e/.test(flags) && /f/.test(flags) || /^aux$|^ax$|^-ef$|^-aux$/.test(a.join(" "))) {
      if (sortKey) {
        var desc = sortKey.charAt(0) === "-", key = sortKey.replace(/^[-+]/, "").replace(/^%/, "");
        var field = { cpu: "cpu", mem: "mem", pid: "pid", rss: "rss", vsz: "vsz", time: "time" }[key];
        if (!field) { ctx.er += "error: clave de ordenación no reconocida\n"; return 1; }
        procs.sort(function (x, y) { var r = typeof x[field] === "number" ? x[field] - y[field] : String(x[field]).localeCompare(String(y[field])); if (r === 0) r = x.pid - y.pid; return desc ? -r : r; });
      }
      var pad2 = function (s, n) { return String(s).padStart(n); };
      if (/ef/.test(flags) && !/aux/.test(flags)) {
        ctx.o += "UID          PID    PPID  C STIME TTY          TIME CMD\n";
        procs.forEach(function (p) { ctx.o += p.user.padEnd(8) + " " + pad2(p.pid, 7) + " " + pad2(p.pid === 1 ? 0 : 1, 7) + "  0 " + p.start + " " + p.tty.padEnd(8) + " 00:00:00 " + p.cmd + "\n"; });
        return;
      }
      ctx.o += "USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n";
      procs.forEach(function (p) {
        ctx.o += p.user.padEnd(8) + " " + pad2(p.pid, 7) + " " + pad2(p.cpu.toFixed(1), 4) + " " + pad2(p.mem.toFixed(1), 4) + " " + pad2(p.vsz, 7) + " " + pad2(p.rss, 6) + " " + p.tty.padEnd(8) + " " + p.stat.padEnd(4) + " " + p.start + " " + pad2(p.time, 6) + " " + p.cmd + "\n";
      });
      return;
    }
    ctx.o += "    PID TTY          TIME CMD\n   2310 pts/0    00:00:00 bash\n" + pad(me.pid, 7, " ") + " pts/0    00:00:00 ps\n";
  };
  CMDS.kill = function (ctx) {
    var a = ctx.args.filter(function (x) { return !/^-(\d+|[A-Z]+|s|l)$/.test(x) && x !== "-9"; }), st = 0, self = this;
    if (ctx.args[0] === "-l") { ctx.o += " 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 9) SIGKILL\t15) SIGTERM\n"; return; }
    if (!a.length) { ctx.er += "kill: uso: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... o kill -l [sigspec]\n"; return 2; }
    a.forEach(function (p) {
      if (!/^\d+$/.test(p)) { ctx.er += "bash: kill: " + p + ": los argumentos deben ser IDs de procesos o trabajos\n"; st = 1; return; }
      var i = self.st.procs.findIndex(function (x) { return x.pid === +p; });
      if (i < 0) { ctx.er += "bash: kill: (" + p + ") - No existe el proceso\n"; st = 1; return; }
      if (self.st.procs[i].user === "root" && !ctx.root) { ctx.er += "bash: kill: (" + p + ") - Operación no permitida\n"; st = 1; return; }
      self.st.procs.splice(i, 1);
    });
    return st;
  };
  CMDS.pkill = function (ctx) {
    var a = ctx.args.filter(function (x) { return x.charAt(0) !== "-"; }), self = this;
    if (!a.length) { ctx.er += "pkill: ningún criterio de coincidencia especificado\n"; return 2; }
    var before = this.st.procs.length;
    this.st.procs = this.st.procs.filter(function (p) { var base = p.cmd.split(" ")[0].split("/").pop(); return !(base.indexOf(a[0]) >= 0 && (p.user === "lliurex" || ctx.root)); });
    return before === this.st.procs.length ? 1 : 0;
  };
  CMDS.killall = function (ctx) {
    var a = ctx.args.filter(function (x) { return x.charAt(0) !== "-"; });
    if (!a.length) { ctx.er += "Uso: killall [OPCIÓN]... [--] NOMBRE...\n"; return 1; }
    var before = this.st.procs.length;
    this.st.procs = this.st.procs.filter(function (p) { var base = p.cmd.split(" ")[0].split("/").pop(); return !(base === a[0] && p.user === "lliurex"); });
    if (before === this.st.procs.length) { ctx.er += a[0] + ": proceso no encontrado\n"; return 1; }
  };
  CMDS.top = function (ctx) { return CMDS.htop.call(this, ctx); };
  CMDS.htop = function (ctx) {
    var self = this, procs = this.st.procs.slice().sort(function (a, b) { return b.cpu - a.cpu; }).slice(0, 8);
    ctx.o += "  CPU[|||||||                 22.4%]   Tasks: " + (this.st.procs.length + 60) + ", 214 thr; 1 running\n  Mem[|||||||||||||||||  2.10G/7.69G]   Load average: 0.52 0.48 0.45\n  Swp[                    0K/2.00G]   Uptime: 02:13:14\n\n";
    ctx.o += "  PID USER      PRI  NI  VIRT   RES   SHR S CPU% MEM%   TIME+  Command\n";
    procs.forEach(function (p) { ctx.o += String(p.pid).padStart(5) + " " + p.user.padEnd(9) + "  20   0 " + (p.vsz / 1024 | 0).toString().padStart(5) + "M " + (p.rss / 1024 | 0).toString().padStart(4) + "M  120 S " + p.cpu.toFixed(1).padStart(4) + " " + p.mem.toFixed(1).padStart(4) + "  " + p.time.padStart(6) + "  " + p.cmd.split(" ")[0] + "\n"; });
    ctx.o += "\n" + C.dim + "(htop real es interactivo: se sale con F10 o q. Aquí ves una captura.)" + C.reset + "\n";
  };

  /* apt */
  var PKGS = {
    htop: { v: "2.2.0-2build1", sec: "utils", size: "212 kB", dep: "libc6 (>= 2.15), libncursesw6 (>= 6), libtinfo6 (>= 6)", home: "https://hisham.hm/htop/", desc: "visor interactivo de procesos", long: " htop es un visor de procesos interactivo, basado en ncurses." },
    tree: { v: "1.8.0-1", sec: "utils", size: "108 kB", dep: "libc6 (>= 2.14)", home: "http://mama.indstate.edu/users/ice/tree/", desc: "muestra los directorios como árboles (versión coloreada)", long: " Tree es un programa que lista el contenido de los directorios en forma de árbol." },
    nano: { v: "4.8-1ubuntu1", sec: "editors", size: "851 kB", dep: "libc6, libncursesw6", home: "https://www.nano-editor.org/", desc: "pequeño y simple editor de texto", long: " GNU nano es un editor de texto fácil de usar." },
    vim: { v: "2:8.1.2269-1ubuntu5", sec: "editors", size: "3.039 kB", dep: "vim-common, libc6", home: "https://www.vim.org/", desc: "Vi IMproved - editor de texto avanzado", long: " Vim es una versión mejorada de vi." },
    curl: { v: "7.68.0-1ubuntu2.20", sec: "web", size: "411 kB", dep: "libc6, libcurl4", home: "https://curl.haxx.se", desc: "herramienta para transferir datos con sintaxis URL", long: " curl descarga y envía datos usando URLs." },
    git: { v: "1:2.25.1-1ubuntu3.11", sec: "vcs", size: "35,2 MB", dep: "libc6, git-man", home: "https://git-scm.com/", desc: "sistema de control de versiones distribuido", long: " Git es un sistema de control de versiones rápido y escalable." }
  };
  function aptCmd(ctx, bin) {
    var a = ctx.args.filter(function (x) { return x.charAt(0) !== "-"; }), sub = a[0], self = this, rest = a.slice(1);
    var lock = "E: No se pudo abrir el fichero de bloqueo /var/lib/dpkg/lock-frontend - open (13: Permiso denegado)\nE: Imposible bloquear el directorio de administración (/var/lib/dpkg/), ¿es superusuario?\n";
    if (!sub) { ctx.o += bin + " 2.0.9 (amd64)\nUso: " + bin + " [opciones] orden\n\nOrdenes más usadas:\n  list - lista los paquetes según el nombre\n  search - busca en las descripciones de los paquetes\n  show - muestra información del paquete\n  install - instala paquetes\n  update - descarga la lista de paquetes\n  upgrade - actualiza el sistema instalando/actualizando paquetes\n"; return; }
    if (sub === "show" || sub === "info") {
      if (!rest.length) { ctx.er += "E: Se requiere el nombre de un paquete\n"; return 100; }
      var st = 0;
      rest.forEach(function (p) {
        var k = PKGS[p];
        if (!k) { ctx.er += "N: No se puede encontrar el paquete " + p + "\nE: No se han encontrado paquetes\n"; st = 100; return; }
        ctx.o += "Package: " + p + "\nVersion: " + k.v + "\nPriority: optional\nSection: " + k.sec + "\nOrigin: Ubuntu\nMaintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\nInstalled-Size: " + k.size + "\nDepends: " + k.dep + "\nHomepage: " + k.home + "\nDownload-Size: 80,2 kB\nAPT-Manual-Installed: " + (self.st.installed[p] ? "yes" : "no") + "\nAPT-Sources: http://es.archive.ubuntu.com/ubuntu focal/main amd64 Packages\nDescription: " + k.desc + "\n" + k.long + "\n\n";
      });
      return st;
    }
    if (sub === "update") {
      if (!ctx.root) { ctx.o += "Leyendo lista de paquetes... Hecho\nE: No se pudo abrir el fichero de bloqueo /var/lib/apt/lists/lock - open (13: Permiso denegado)\nE: No se pudo bloquear el directorio /var/lib/apt/lists/\nW: Problema al eliminar el fichero de bloqueo... \n"; return 100; }
      ctx.o += "Obj:1 http://es.archive.ubuntu.com/ubuntu focal InRelease\nObj:2 http://es.archive.ubuntu.com/ubuntu focal-updates InRelease\nObj:3 http://es.archive.ubuntu.com/ubuntu focal-security InRelease\nLeyendo lista de paquetes... Hecho\nCreando árbol de dependencias\nLeyendo la información de estado... Hecho\nTodos los paquetes están actualizados.\n"; return;
    }
    if (sub === "upgrade" || sub === "full-upgrade" || sub === "dist-upgrade") {
      if (!ctx.root) { ctx.er += lock; return 100; }
      ctx.o += "Leyendo lista de paquetes... Hecho\nCreando árbol de dependencias\nLeyendo la información de estado... Hecho\nCalculando la actualización... Hecho\n0 actualizados, 0 nuevos se instalarán, 0 para eliminar y 0 no actualizados.\n"; return;
    }
    if (sub === "install" || sub === "remove" || sub === "purge") {
      if (!ctx.root) { ctx.er += lock; return 100; }
      if (!rest.length) { ctx.o += "0 actualizados, 0 nuevos se instalarán, 0 para eliminar y 0 no actualizados.\n"; return; }
      var s2 = 0;
      rest.forEach(function (p) {
        if (!PKGS[p]) { ctx.er += "E: No se ha podido localizar el paquete " + p + "\n"; s2 = 100; return; }
        if (sub === "install") {
          if (self.st.installed[p]) ctx.o += "Leyendo lista de paquetes... Hecho\nCreando árbol de dependencias\nLeyendo la información de estado... Hecho\n" + p + " ya está en su versión más reciente (" + PKGS[p].v + ").\n0 actualizados, 0 nuevos se instalarán, 0 para eliminar y 0 no actualizados.\n";
          else { ctx.o += "Leyendo lista de paquetes... Hecho\nSe instalarán los siguientes paquetes NUEVOS:\n  " + p + "\n0 actualizados, 1 nuevos se instalarán, 0 para eliminar y 0 no actualizados.\nDescomprimiendo " + p + " (" + PKGS[p].v + ") ...\nConfigurando " + p + " (" + PKGS[p].v + ") ...\n"; self.st.installed[p] = true; }
        } else { if (self.st.installed[p]) { delete self.st.installed[p]; ctx.o += "Eliminando " + p + " (" + PKGS[p].v + ") ...\n"; } else ctx.er += "Paquete '" + p + "' no está instalado, no se puede eliminar\n"; }
      });
      return s2;
    }
    if (sub === "search") { ctx.o += "Ordenando... Hecho\nBuscando... Hecho\n"; Object.keys(PKGS).filter(function (k) { return !rest[0] || k.indexOf(rest[0]) >= 0 || PKGS[k].desc.indexOf(rest[0]) >= 0; }).forEach(function (k) { ctx.o += k + "/focal " + PKGS[k].v + " amd64\n  " + PKGS[k].desc + "\n\n"; }); return; }
    ctx.er += "E: La orden «" + sub + "» no es válida\n"; return 100;
  }
  CMDS.apt = function (ctx) { return aptCmd.call(this, ctx, "apt"); };
  CMDS["apt-get"] = function (ctx) { return aptCmd.call(this, ctx, "apt-get"); };

  /* ayuda */
  var HELP = {
    pwd: "pwd — muestra la ruta del directorio actual.", cd: "cd [dir] — cambia de directorio. cd .. sube, cd sin nada va a casa, cd - vuelve al anterior.",
    ls: "ls [-l -a -i -R -h] [ruta…] — lista el contenido. -l largo, -a ocultos, -i inodos, -R recursivo.",
    mkdir: "mkdir [-p] dir… — crea directorios. -p crea también los intermedios.", rmdir: "rmdir dir… — borra directorios vacíos.",
    touch: "touch fichero… — crea ficheros vacíos (o actualiza la fecha).", cp: "cp [-r] origen… destino — copia. -r para directorios.",
    mv: "mv origen… destino — mueve o renombra.", rm: "rm [-r -f -i] ruta… — borra. -r directorios, -f sin preguntar.",
    echo: "echo texto — imprime texto (con > o >> lo guarda en un fichero).", cat: "cat [-n] fichero… — muestra ficheros. -n numera las líneas.",
    grep: "grep [-v -i -n -c] patrón fichero… — líneas que contienen el patrón. -v las que NO.", find: "find ruta [-name patrón] [-type f|d] — busca ficheros.",
    head: "head [-n N] fichero — primeras N líneas (10 por defecto).", tail: "tail [-n N] fichero — últimas N líneas.",
    sort: "sort [-k N] [-t sep] [-n] [-r] fichero — ordena. -k campo, -t separador, -n numérico, -r inverso.",
    wc: "wc [-l -w -c] fichero — cuenta líneas, palabras, bytes.", cut: "cut -d sep -f campos fichero — corta columnas. -c cortar por caracteres.",
    tr: "tr [-d -s] set1 [set2] — traduce o borra caracteres de la entrada (usa tuberías).", gzip: "gzip [-k -d] fichero — comprime. -k mantiene el original, -d descomprime.",
    ln: "ln [-s] origen destino — enlace duro (o simbólico con -s).", chmod: "chmod modo fichero — cambia permisos. Octal (755) o simbólico (u+x, go-rw, a=r).",
    tree: "tree [dir] — dibuja el árbol de directorios.", uname: "uname [-a] — datos del sistema y kernel.", lscpu: "lscpu — ficha de la CPU.",
    free: "free [-h] — memoria RAM y swap.", df: "df [-h] [ruta] — espacio de los discos.", lsblk: "lsblk — discos y particiones.", lspci: "lspci — dispositivos PCI.",
    lsusb: "lsusb — dispositivos USB.", uptime: "uptime — tiempo encendido y carga.", who: "who — usuarios conectados.", dmesg: "dmesg [-H] — mensajes del kernel.",
    date: "date [+formato] — fecha y hora. Ej: date +\"%Y-%m-%d %H:%M:%S\"", cal: "cal [[mes] año] — calendario.", du: "du [-s -a -h] ruta — espacio ocupado.",
    ps: "ps aux [--sort -%cpu] — procesos.", kill: "kill PID — termina un proceso por su PID.", pkill: "pkill nombre — termina procesos por nombre.", htop: "htop — monitor interactivo.",
    apt: "apt install|show|update|upgrade paquete — gestor de paquetes (con sudo para instalar).", sudo: "sudo orden — ejecuta como administrador."
  };
  CMDS.man = function (ctx) { var c = ctx.args[0]; if (!c) { ctx.er += "¿Qué página de manual desea?\n"; return 1; } if (!HELP[c]) { ctx.er += "No hay ninguna entrada de manual para " + c + "\n"; return 16; } ctx.o += c.toUpperCase() + "(1)\n\nRESUMEN\n    " + HELP[c] + "\n\n(En el simulador solo hay un resumen del manual.)\n"; };
  CMDS.help = function (ctx) {
    var c = ctx.args[0];
    if (c && HELP[c]) { ctx.o += HELP[c] + "\n"; return; }
    ctx.o += "Comandos disponibles en el simulador de Linux:\n\n" + Object.keys(CMDS).filter(function (k) { return ["true", "false", "sleep", "exit", "export", "top", "gunzip", "zcat", "killall", "uniq", "stat", "file", "man", "help"].indexOf(k) < 0; }).sort().join("  ") + "\n\nPrueba también: history, clear, man <comando>, help <comando>.\nTab autocompleta, ↑/↓ recorre el historial, Ctrl+L limpia la pantalla.\n";
  };
  // --help para cualquier comando conocido
  Object.keys(CMDS).forEach(function (k) {
    var f = CMDS[k];
    CMDS[k] = function (ctx) { if (ctx.args.length === 1 && ctx.args[0] === "--help" && HELP[k]) { ctx.o += HELP[k] + "\n"; return 0; } return f.call(this, ctx); };
  });

  Sim.linuxCommandNames = function () { return Object.keys(CMDS).concat(["sudo"]); };
  Sim.LinuxShell.tokenize = tokenize;
})(typeof window !== "undefined" ? window : globalThis);
