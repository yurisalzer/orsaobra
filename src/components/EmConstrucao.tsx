export function EmConstrucao({ titulo, etapa }: { titulo: string; etapa: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{titulo}</h1>
      <p className="mt-4 rounded-md border border-dashed border-slate-300 bg-white p-6 text-slate-500">
        Módulo previsto para a {etapa}.
      </p>
    </div>
  );
}
