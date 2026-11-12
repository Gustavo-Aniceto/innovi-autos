import { useState } from "react";
import { useInstall } from "../lib/install";
import { ConfirmDialog } from "./ConfirmDialog";

/** Botão "Instalar aplicativo". Some quando o app já está instalado ou o navegador não permite instalar. */
export function InstallApp({ small }: { small?: boolean }) {
  const { state, install } = useInstall();
  const [help, setHelp] = useState(false);
  if (state === "installed" || state === "none") return null;
  return (
    <>
      <button type="button" className={`btn btn-ghost-dark install-btn${small ? " btn-sm" : ""}`}
        onClick={() => (state === "prompt" ? install() : setHelp(true))}>
        Instalar aplicativo
      </button>
      <ConfirmDialog open={help} title="Instalar no iPhone ou iPad" confirmLabel="Entendi" onConfirm={() => setHelp(false)} onClose={() => setHelp(false)}>
        <p>O aparelho da Apple não abre a instalação sozinho. Faça assim, no Safari:</p>
        <ol className="install-steps">
          <li>Toque no botão <strong>Compartilhar</strong> (o quadrado com a seta para cima).</li>
          <li>Role a lista e toque em <strong>Adicionar à Tela de Início</strong>.</li>
          <li>Toque em <strong>Adicionar</strong>. O ícone "Innovi Oficina" aparece na tela do aparelho.</li>
        </ol>
      </ConfirmDialog>
    </>
  );
}
