"use server";

import { redirect } from "next/navigation";
import { sair } from "@/lib/auth/sessao";

export async function acaoSair() {
  await sair();
  redirect("/login");
}
