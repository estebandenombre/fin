import {
  ArrowUp,
  FileText,
  LayoutPanelTop,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Sparkles,
} from "lucide-react";
import styles from "./page.module.css";

const messages = [
  {
    id: 1,
    author: "Tú",
    tone: "user",
    text: "Necesito transformar mis notas de estrategia en un documento claro, sobrio y listo para compartir.",
  },
  {
    id: 2,
    author: "Asistente",
    tone: "assistant",
    text: "He ordenado las ideas en una estructura editorial: contexto, decisiones, riesgos y próximos pasos. Mantengo el tono directo, con espacio visual suficiente para leer sin fricción.",
  },
  {
    id: 3,
    author: "Tú",
    tone: "user",
    text: "Haz que el resumen se sienta más ejecutivo, pero sin sonar frío.",
  },
  {
    id: 4,
    author: "Asistente",
    tone: "assistant",
    text: "Perfecto. He reducido la densidad, reforzado los titulares y dejado cada bloque con una única intención. La versión aparece en el panel de la derecha.",
  },
];

export default function ClaudeLikeInterface() {
  return (
    <main className={styles.pageShell}>
      <section className={styles.chatPanel} aria-label="Chat">
        <header className={styles.chatHeader}>
          <div className={styles.brandMark} aria-hidden="true">
            <Sparkles size={18} />
          </div>
          <div>
            <p>Estudio privado</p>
            <h1>Conversación</h1>
          </div>
          <button className={styles.ghostIconButton} type="button" aria-label="Más opciones">
            <MoreHorizontal size={18} />
          </button>
        </header>

        <div className={styles.messageStack}>
          {messages.map((message) => (
            <article className={styles.message} data-tone={message.tone} key={message.id}>
              <div className={styles.avatar}>{message.author === "Tú" ? "T" : "A"}</div>
              <div className={styles.messageBody}>
                <span>{message.author}</span>
                <p>{message.text}</p>
              </div>
            </article>
          ))}
        </div>

        <form className={styles.composer} aria-label="Enviar mensaje">
          <textarea
            aria-label="Mensaje"
            placeholder="Escribe aquí..."
            rows={1}
            defaultValue=""
          />
          <div className={styles.composerFooter}>
            <button className={styles.ghostButton} type="button">
              <Paperclip size={16} />
              Adjuntar
            </button>
            <button className={styles.sendButton} type="submit" aria-label="Enviar">
              <ArrowUp size={18} />
            </button>
          </div>
        </form>
      </section>

      <aside className={styles.artifactPanel} aria-label="Previsualización">
        <header className={styles.artifactHeader}>
          <div className={styles.artifactTitle}>
            <span>
              <LayoutPanelTop size={17} />
            </span>
            <div>
              <p>Artifact</p>
              <h2>Resumen ejecutivo</h2>
            </div>
          </div>
          <button className={styles.ghostButton} type="button">
            <FileText size={16} />
            Exportar
          </button>
        </header>

        <div className={styles.documentPreview}>
          <div className={styles.documentTopline}>
            <MessageSquareText size={16} />
            Documento vivo
          </div>
          <h3>Plan de enfoque trimestral</h3>
          <p className={styles.lede}>
            La prioridad del trimestre es simplificar la toma de decisiones y concentrar el equipo en
            iniciativas con impacto medible.
          </p>

          <div className={styles.documentGrid}>
            <section>
              <span>01</span>
              <h4>Contexto</h4>
              <p>Demasiados frentes abiertos reducen claridad y velocidad.</p>
            </section>
            <section>
              <span>02</span>
              <h4>Decisión</h4>
              <p>Reducir el trabajo activo y priorizar entregables completos.</p>
            </section>
            <section>
              <span>03</span>
              <h4>Riesgo</h4>
              <p>La simplificación debe proteger el aprendizaje ya acumulado.</p>
            </section>
            <section>
              <span>04</span>
              <h4>Siguiente paso</h4>
              <p>Definir una cadencia semanal de revisión breve y accionable.</p>
            </section>
          </div>
        </div>
      </aside>
    </main>
  );
}
