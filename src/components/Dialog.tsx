import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      className="dialog"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-inner">
        <div className="dialog-heading">
          <h2 id="dialog-title">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar ventana">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
