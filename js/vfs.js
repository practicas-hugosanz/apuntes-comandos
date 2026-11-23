/* Sistema de ficheros virtual (compartido por Linux y PowerShell).
   Rutas internas siempre estilo POSIX. El estado es un objeto JSON puro,
   asi se puede clonar y restaurar (para corregir ejercicios). */
(function (g) {
  "use strict";
  var BASE_TIME = new Date(2025, 0, 8, 14, 35, 45).getTime(); // fecha congelada del simulador

  function VFS(state, ci) { this.s = state; this.ci = !!ci; }

  VFS.create = function () {
    return { next: 2, root: 1, now: BASE_TIME,
      inodes: { 1: { id: 1, type: "d", mode: 493, nlink: 2, entries: {}, m: BASE_TIME } } };
  };
  VFS.BASE_TIME = BASE_TIME;
  VFS.clone = function (st) { return JSON.parse(JSON.stringify(st)); };

  var P = VFS.prototype;
  P.node = function (id) { return this.s.inodes[id]; };
  P.touchTime = function (n) { n.m = this.s.now; };

  P._find = function (dir, name) {
    var e = dir.entries;
    if (Object.prototype.hasOwnProperty.call(e, name)) return name;
    if (this.ci) { var l = name.toLowerCase(); for (var k in e) if (k.toLowerCase() === l) return k; }
    return null;
  };

  P.newInode = function (type, mode, extra) {
    var id = this.s.next++;
    var n = { id: id, type: type, mode: mode, nlink: type === "d" ? 2 : 1, m: this.s.now };
    if (type === "d") n.entries = {};
    if (type === "f") n.content = "";
    for (var k in (extra || {})) n[k] = extra[k];
    this.s.inodes[id] = n;
    return n;
  };

  /* Resuelve una ruta. Devuelve {id|null, parent, name, abs, err} */
  P.resolve = function (path, cwd, follow) {
    if (follow === undefined) follow = true;
    var queue = (path.charAt(0) === "/" ? path : (cwd + "/" + path)).split("/");
    var stack = [{ id: this.s.root, name: "" }];
    var links = 0, i = 0;
    var lastIdx = function () { var j = queue.length - 1; while (j >= 0 && (queue[j] === "" || queue[j] === ".")) j--; return j; };
    while (i < queue.length) {
      var c = queue[i];
      if (c === "" || c === ".") { i++; continue; }
      if (c === "..") { if (stack.length > 1) stack.pop(); i++; continue; }
      var cur = this.node(stack[stack.length - 1].id);
      if (cur.type !== "d") return { id: null, err: "ENOTDIR" };
      var isLast = (i === lastIdx());
      var key = this._find(cur, c);
      if (key === null) {
        if (isLast) return { id: null, parent: cur.id, name: c, abs: this._abs(stack) + (stack.length > 1 ? "/" : "") + c, err: "ENOENT" };
        return { id: null, err: "ENOENT" };
      }
      var ch = this.node(cur.entries[key]);
      if (ch.type === "l" && (follow || !isLast)) {
        if (++links > 20) return { id: null, err: "ELOOP" };
        var rest = queue.slice(i + 1);
        var tcomps = ch.target.split("/");
        if (ch.target.charAt(0) === "/") stack = [{ id: this.s.root, name: "" }];
        queue = tcomps.concat(rest); i = 0; continue;
      }
      stack.push({ id: ch.id, name: key });
      i++;
    }
    var top = stack[stack.length - 1];
    var par = stack.length > 1 ? stack[stack.length - 2].id : null;
    return { id: top.id, parent: par, name: top.name, abs: this._abs(stack) };
  };
  P._abs = function (stack) { return stack.length === 1 ? "/" : stack.slice(1).map(function (x) { return x.name; }).join("/").replace(/^/, "/"); };

  P.exists = function (path, cwd) { return this.resolve(path, cwd).id !== null; };
  P.stat = function (path, cwd, follow) { var r = this.resolve(path, cwd, follow); return r.id === null ? null : this.node(r.id); };

  P.size = function (n) {
    if (n.type === "d") return 4096;
    if (n.type === "l") return n.target.length;
    if (n.size !== undefined) return n.size;
    return utf8len(n.content);
  };
  function utf8len(s) { var b = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); b += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c < 0xdc00) ? (i++, 4) : 3; } return b; }
  VFS.utf8len = utf8len;

  P.names = function (id) { return Object.keys(this.node(id).entries); };

  P.mkdir = function (path, cwd, parents, mode) {
    var r = this.resolve(path, cwd);
    if (r.id !== null) return parents ? null : "EEXIST";
    if (r.err === "ENOENT" && r.parent === undefined) {
      if (!parents) return "ENOENT";
      // crear intermedios
      var comps = path.split("/").filter(function (x) { return x !== "" && x !== "."; });
      var base = path.charAt(0) === "/" ? "/" : cwd, acc = base;
      for (var i = 0; i < comps.length; i++) {
        acc = (acc === "/" ? "" : acc) + "/" + comps[i];
        if (comps[i] === "..") continue;
        var rr = this.resolve(acc, "/");
        if (rr.id === null) { var e = this.mkdir(acc, "/", false, mode); if (e) return e; }
      }
      return null;
    }
    if (r.err && r.err !== "ENOENT") return r.err;
    var par = this.node(r.parent);
    var n = this.newInode("d", mode === undefined ? 509 : mode);
    par.entries[r.name] = n.id; par.nlink++; this.touchTime(par);
    return null;
  };

  P.writeFile = function (path, cwd, data, append, mode) {
    var r = this.resolve(path, cwd);
    if (r.id !== null) {
      var n = this.node(r.id);
      if (n.type === "d") return "EISDIR";
      if (n.gz) { n.gz = false; delete n.size; }
      n.content = append ? n.content + data : data; this.touchTime(n); return null;
    }
    if (r.err !== "ENOENT" || r.parent === undefined) return r.err || "ENOENT";
    var f = this.newInode("f", mode === undefined ? 436 : mode, { content: data });
    var par = this.node(r.parent); par.entries[r.name] = f.id; this.touchTime(par);
    return null;
  };

  P.readFile = function (path, cwd) {
    var r = this.resolve(path, cwd);
    if (r.id === null) return { err: r.err || "ENOENT" };
    var n = this.node(r.id);
    if (n.type === "d") return { err: "EISDIR" };
    if (n.gz) return { data: "\u001f�\b\u0000\u0000\u0000\u0000\u0000\u0000\u0003��K���\u0007\u0000��\n" , node: n };
    return { data: n.content, node: n };
  };

  /* borra una entrada (fichero/enlace). Devuelve error o null */
  P.unlink = function (path, cwd) {
    var r = this.resolve(path, cwd, false);
    if (r.id === null) return r.err || "ENOENT";
    var n = this.node(r.id);
    if (n.type === "d") return "EISDIR";
    var par = this.node(r.parent);
    delete par.entries[r.name]; this.touchTime(par);
    n.nlink--; if (n.nlink <= 0) delete this.s.inodes[n.id];
    return null;
  };
  P.rmdir = function (path, cwd) {
    var r = this.resolve(path, cwd, false);
    if (r.id === null) return r.err || "ENOENT";
    var n = this.node(r.id);
    if (n.type !== "d") return "ENOTDIR";
    if (Object.keys(n.entries).length) return "ENOTEMPTY";
    if (r.id === this.s.root) return "EBUSY";
    var par = this.node(r.parent); delete par.entries[r.name]; par.nlink--; this.touchTime(par);
    delete this.s.inodes[n.id];
    return null;
  };
  P.removeTree = function (path, cwd) {
    var r = this.resolve(path, cwd, false);
    if (r.id === null) return r.err || "ENOENT";
    var n = this.node(r.id);
    if (n.type === "d") {
      var self = this;
      Object.keys(n.entries).forEach(function (k) { self.removeTree(r.abs + "/" + k, "/"); });
      return this.rmdir(r.abs, "/");
    }
    return this.unlink(r.abs, "/");
  };

  P.link = function (src, dst, cwd) {
    var a = this.resolve(src, cwd, false);
    if (a.id === null) return "ENOENT";
    var n = this.node(a.id);
    if (n.type === "d") return "EPERM";
    var d = this.resolve(dst, cwd);
    var parent, name;
    if (d.id !== null) {
      var dn = this.node(d.id);
      if (dn.type !== "d") return "EEXIST";
      parent = dn; name = a.name;
      if (this._find(parent, name) !== null) return "EEXIST";
    } else { if (d.parent === undefined) return "ENOENT"; parent = this.node(d.parent); name = d.name; }
    parent.entries[name] = n.id; n.nlink++; this.touchTime(parent);
    return null;
  };
  P.symlink = function (target, dst, cwd) {
    var d = this.resolve(dst, cwd, false);
    var parent, name;
    if (d.id !== null) {
      var dn = this.node(d.id);
      if (dn.type !== "d") return "EEXIST";
      parent = dn; name = target.split("/").filter(Boolean).pop() || target;
      if (this._find(parent, name) !== null) return "EEXIST";
    } else { if (d.parent === undefined) return "ENOENT"; parent = this.node(d.parent); name = d.name; }
    var n = this.newInode("l", 511, { target: target });
    parent.entries[name] = n.id; this.touchTime(parent);
    return null;
  };

  /* mueve/renombra. Devuelve error o null */
  P.rename = function (src, dst, cwd) {
    var a = this.resolve(src, cwd, false);
    if (a.id === null) return "ENOENT";
    if (a.id === this.s.root) return "EBUSY";
    var n = this.node(a.id);
    var d = this.resolve(dst, cwd);
    var parentId, name;
    if (d.id !== null) {
      var dn = this.node(d.id);
      if (dn.id === n.id && a.abs === d.abs) return "SAME";
      if (dn.type === "d") {
        parentId = dn.id; name = a.name;
        if (this._find(dn, name) !== null) {
          var ex = this.node(dn.entries[this._find(dn, name)]);
          if (ex.type === "d") { if (n.type !== "d") return "EISDIR"; if (Object.keys(ex.entries).length) return "ENOTEMPTY"; }
          this._dropEntry(dn, this._find(dn, name));
        }
      } else {
        if (n.type === "d") return "ENOTDIR";
        parentId = d.parent; name = d.name; this._dropEntry(this.node(d.parent), this._find(this.node(d.parent), d.name) || d.name);
      }
    } else { if (d.parent === undefined) return "ENOENT"; parentId = d.parent; name = d.name; }
    if (n.type === "d" && this._isInside(parentId, n.id)) return "EINVAL";
    var op = this.node(a.parent), np = this.node(parentId);
    delete op.entries[a.name]; np.entries[name] = n.id;
    if (n.type === "d" && op.id !== np.id) { op.nlink--; np.nlink++; }
    this.touchTime(op); this.touchTime(np);
    return null;
  };
  P._dropEntry = function (dir, key) {
    var id = dir.entries[key]; if (id === undefined) return;
    var n = this.node(id); delete dir.entries[key];
    if (n.type === "d") { dir.nlink--; delete this.s.inodes[id]; } else { n.nlink--; if (n.nlink <= 0) delete this.s.inodes[id]; }
  };
  P._isInside = function (dirId, ancestorId) {
    if (dirId === ancestorId) return true;
    var n = this.node(ancestorId); if (n.type !== "d") return false;
    for (var k in n.entries) { if (this._isInside(dirId, n.entries[k])) return true; }
    return false;
  };

  /* copia fichero o (si recursive) directorio. */
  P.copy = function (src, dst, cwd, recursive) {
    var a = this.resolve(src, cwd);
    if (a.id === null) return "ENOENT";
    var n = this.node(a.id);
    if (n.type === "d" && !recursive) return "ENOTR";
    var d = this.resolve(dst, cwd);
    var parent, name;
    if (d.id !== null && this.node(d.id).type === "d") {
      parent = this.node(d.id); name = a.name === "" ? "root" : a.name;
      if (n.type === "d" && this._isInside(parent.id, n.id)) return "EINVAL";
    } else if (d.id !== null) {
      if (n.type === "d") return "ENOTDIR";
      var dn = this.node(d.id); if (dn.id === n.id) return "SAME";
      dn.content = n.content; if (n.gz) { dn.gz = true; dn.size = n.size; } dn.mode = n.mode; this.touchTime(dn); return null;
    } else { if (d.parent === undefined) return "ENOENT"; parent = this.node(d.parent); name = d.name; }
    var key = this._find(parent, name);
    if (key !== null) {
      var ex = this.node(parent.entries[key]);
      if (ex.type === "d") return "EISDIR";
      ex.content = n.content; this.touchTime(ex); return null;
    }
    parent.entries[name] = this._clone(n).id; this.touchTime(parent);
    return null;
  };
  P._clone = function (n) {
    var c = this.newInode(n.type, n.mode, n.type === "l" ? { target: n.target } : {});
    if (n.type === "f") { c.content = n.content; if (n.gz) { c.gz = true; c.size = n.size; } }
    if (n.type === "d") { var self = this; Object.keys(n.entries).forEach(function (k) { var ch = self._clone(self.node(n.entries[k])); c.entries[k] = ch.id; if (ch.type === "d") c.nlink++; }); }
    return c;
  };

  /* total de bloques de 1 KB usados (como du) */
  P.usage = function (id, cb, rel) {
    var n = this.node(id), self = this, total = 0;
    if (n.type === "d") {
      Object.keys(n.entries).forEach(function (k) {
        total += self.usage(n.entries[k], cb, (rel ? rel + "/" : "") + k);
      });
      total += 4096;
    } else {
      var sz = this.size(n); total = n.type === "l" ? 0 : (sz === 0 ? 0 : Math.ceil(sz / 4096) * 4096);
    }
    if (cb) cb(rel, total, n);
    return total;
  };

  /* glob (*, ?, [..]) -> lista de rutas como se escribieron. */
  VFS.globToRegex = function (pat, ci) {
    var re = "^";
    for (var i = 0; i < pat.length; i++) {
      var c = pat.charAt(i);
      if (c === "\\" && i + 1 < pat.length) { re += escRe(pat.charAt(++i)); }
      else if (c === "*") re += ".*";
      else if (c === "?") re += ".";
      else if (c === "[") {
        var j = pat.indexOf("]", i + 2);
        if (j > 0) { var body = pat.slice(i + 1, j).replace(/^!/, "^").replace(/\\/g, "\\\\"); re += "[" + body + "]"; i = j; } else re += "\\[";
      } else re += escRe(c);
    }
    return new RegExp(re + "$", ci ? "i" : "");
  };
  function escRe(c) { return c.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&"); }
  VFS.hasGlob = function (s) { return /(^|[^\\])[*?\[]/.test(s); };

  P.glob = function (pattern, cwd) {
    var abs = pattern.charAt(0) === "/";
    var segs = pattern.split("/");
    var self = this;
    var cur = [{ disp: abs ? "/" : "", path: abs ? "/" : cwd }];
    segs.forEach(function (seg, idx) {
      if (seg === "" && idx === 0) return;
      var next = [];
      cur.forEach(function (c) {
        var sep = c.disp === "" || c.disp === "/" ? "" : "/";
        if (!VFS.hasGlob(seg)) {
          var plain = seg.replace(/\\(.)/g, "$1");
          if (plain === "") { next.push({ disp: c.disp, path: c.path }); return; }
          next.push({ disp: c.disp + sep + plain, path: (c.path === "/" ? "" : c.path) + "/" + plain, lit: true });
          return;
        }
        var r = self.resolve(c.path, "/");
        if (r.id === null) return;
        var d = self.node(r.id); if (d.type !== "d") return;
        var re = VFS.globToRegex(seg, self.ci);
        Object.keys(d.entries).forEach(function (name) {
          if (name.charAt(0) === "." && seg.charAt(0) !== ".") return;
          if (re.test(name)) next.push({ disp: c.disp + sep + name, path: (c.path === "/" ? "" : c.path) + "/" + name });
        });
      });
      cur = next;
    });
    var out = cur.filter(function (c) { return self.resolve(c.path, "/", false).id !== null; }).map(function (c) { return c.disp; });
    out.sort(function (a, b) { return cmpName(a, b); });
    return out;
  };

  /* orden parecido al del ls en espanol (ignora mayusculas y puntos iniciales) */
  function cmpName(a, b) {
    var x = a.replace(/^\./, "").toLowerCase(), y = b.replace(/^\./, "").toLowerCase();
    var r = x.localeCompare(y, "es");
    return r !== 0 ? r : (a < b ? -1 : a > b ? 1 : 0);
  }
  VFS.cmpName = cmpName;

  g.VFS = VFS;
})(typeof window !== "undefined" ? window : globalThis);
