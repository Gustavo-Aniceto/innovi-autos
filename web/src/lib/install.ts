// Instalação do app (PWA) pelo navegador.
// O Chrome/Edge/Android avisam UMA vez (beforeinstallprompt), possivelmente antes de qualquer tela montar:
// por isso a escuta começa em main.tsx (initInstall) e as telas só consultam o estado guardado aqui.
import { useSyncExternalStore } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState = "installed" | "prompt" | "ios" | "none";

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function initInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // guarda o convite para mostrar no nosso botão
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => { deferred = null; emit(); });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", emit);
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhone/iPad: não existe convite automático; a instalação é manual pelo menu Compartilhar. */
const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function snapshot(): InstallState {
  if (isStandalone()) return "installed";
  if (deferred) return "prompt";
  if (isIos()) return "ios";
  return "none";
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  const ev = deferred;
  deferred = null; // o convite só pode ser usado uma vez
  emit();
  await ev.prompt();
  await ev.userChoice;
}

export function useInstall(): { state: InstallState; install: () => Promise<void> } {
  const state = useSyncExternalStore(subscribe, snapshot, () => "none" as InstallState);
  return { state, install: promptInstall };
}
