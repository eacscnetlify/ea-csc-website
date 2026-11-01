import { useId } from 'react'

export default function FileDropzone({
  disabled,
  onSelect,
}: {
  disabled: boolean
  onSelect: (files: File[]) => void
}) {
  const id = useId()
  return (
    <div
      className="rounded-xl border-2 border-dashed border-emerald-700 bg-emerald-50 p-5"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        if (!disabled) onSelect(Array.from(event.dataTransfer.files))
      }}
    >
      <label htmlFor={id} className="block font-semibold">
        Choose one attachment, or drop it here
      </label>
      <p id={`${id}-help`} className="mt-2 text-sm text-slate-700">
        PDF, DOCX, JPEG or PNG · maximum 10,000,000 bytes
      </p>
      <input
        id={id}
        type="file"
        accept=".pdf,.docx,.jpg,.jpeg,.png"
        disabled={disabled}
        aria-describedby={`${id}-help`}
        className="mt-3 block w-full rounded-lg border border-slate-400 bg-white p-3 disabled:opacity-50"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length) onSelect(files)
        }}
      />
    </div>
  )
}
