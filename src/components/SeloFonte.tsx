export function SeloFonte({ fonte }: { fonte: string }) {
  const cor = fonte === "SINAPI" ? "bg-sky-100 text-sky-900" : fonte === "EMOP" ? "bg-emerald-100 text-emerald-900" : fonte === "SICRO" ? "bg-amber-100 text-amber-900" : "bg-violet-100 text-violet-900";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cor}`}>{fonte === "PROPRIA" ? "PRÓPRIA" : fonte}</span>;
}
