const globalWithLit = globalThis;

globalWithLit.litIssuedWarnings ??= new Set();
globalWithLit.litIssuedWarnings.add("dev-mode");
