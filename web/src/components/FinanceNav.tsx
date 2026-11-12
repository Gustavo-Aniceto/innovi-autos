import { NavLink } from "react-router-dom";

const ITEMS = [
  { to: "/sistema/financeiro", label: "Receitas", end: true },
  { to: "/sistema/financeiro/saidas", label: "Saídas", end: false },
  { to: "/sistema/financeiro/relatorios", label: "Relatórios", end: false },
];

/** Atalhos entre as áreas do financeiro (só o MasterAdm chega aqui). */
export function FinanceNav() {
  return (
    <nav className="fin-nav" aria-label="Áreas do financeiro">
      {ITEMS.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }: { isActive: boolean }) => (isActive ? "on" : "")}>{i.label}</NavLink>
      ))}
    </nav>
  );
}
