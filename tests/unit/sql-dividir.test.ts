import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { dividirSql } from "@/lib/banco/sql-dividir";

describe("dividirSql", () => {
  it("respeita comentários, aspas e blocos $$", () => {
    const r = dividirSql(`
      -- comentário; com ponto e vírgula
      CREATE TABLE a (x text DEFAULT 'a;b''c');
      /* bloco; */ CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'x;y'; END $$;
      SELECT $tag$ ; $tag$;
    `);
    expect(r).toHaveLength(3);
    expect(r[0]).toBe("CREATE TABLE a (x text DEFAULT 'a;b''c')");
    expect(r[1]).toContain("END $$");
    expect(r[2]).toBe("SELECT $tag$ ; $tag$");
  });
  it("divide as migrações reais sem erro", () => {
    const dir = path.join(process.cwd(), "prisma", "migrations");
    for (const d of fs.readdirSync(dir).filter((x) => !x.endsWith(".toml"))) {
      const cmds = dividirSql(fs.readFileSync(path.join(dir, d, "migration.sql"), "utf8"));
      expect(cmds.length).toBeGreaterThan(0);
      for (const c of cmds) expect(c).not.toMatch(/^\s*;/);
    }
  });
});
