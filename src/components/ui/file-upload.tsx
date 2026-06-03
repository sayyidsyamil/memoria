import { useRef, useState } from 'react'
import { FileArrowUp } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useDropzone } from 'react-dropzone'
import { cn } from '@/lib/utils'

interface FileUploadProps {
  onChange?: (files: File[]) => void
  onChooseFile?: () => void
  className?: string
  title?: string
  description?: string
  compact?: boolean
}

const mainVariant = {
  initial: { x: 0, y: 0 },
  animate: { x: 8, y: -8, opacity: 0.9 },
}

const secondaryVariant = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
}

export function FileUpload({
  onChange,
  onChooseFile,
  className,
  title = 'Upload file',
  description = 'Drag or drop your files here or click to upload',
  compact = false,
}: FileUploadProps) {
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (newFiles: File[]) => {
    setFiles((previousFiles) => [...previousFiles, ...newFiles])
    onChange?.(newFiles)
  }

  const handleClick = () => {
    if (onChooseFile) {
      onChooseFile()
      return
    }
    fileInputRef.current?.click()
  }

  const { getRootProps, isDragActive } = useDropzone({
    multiple: false,
    noClick: true,
    onDrop: handleFileChange,
  })

  const latestFile = files.at(-1)

  return (
    <div className={cn('w-full', className)} {...getRootProps()}>
      <motion.div
        onClick={handleClick}
        whileHover="animate"
        className={cn(
          'group/file relative block w-full cursor-pointer overflow-hidden rounded-md border border-dashed border-border bg-background',
          compact ? 'p-3' : 'p-8',
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={(event) => handleFileChange(Array.from(event.target.files || []))}
          className="hidden"
        />
        <div className="absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,white,transparent)]">
          <GridPattern compact={compact} />
        </div>
        <div className="relative z-10 flex items-center gap-3">
          <div className={cn('relative flex shrink-0 items-center justify-center rounded-md bg-card shadow-sm', compact ? 'h-9 w-9' : 'h-16 w-16')}>
            <motion.div
              variants={mainVariant}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="flex h-full w-full items-center justify-center rounded-md border border-border bg-card"
            >
              <FileArrowUp size={compact ? 16 : 20} className="text-muted-foreground" />
            </motion.div>
            <motion.div variants={secondaryVariant} className="absolute inset-0 rounded-md border border-dashed border-primary opacity-0" />
          </div>
          <div className="min-w-0 text-left">
            <p className="m-0 truncate text-[12px] font-semibold text-foreground">
              {latestFile?.name ?? title}
            </p>
            <p className="m-0 truncate text-[11px] text-muted-foreground">
              {isDragActive ? 'Drop to stage file' : latestFile ? `${(latestFile.size / (1024 * 1024)).toFixed(2)} MB` : description}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

function GridPattern({ compact }: { compact: boolean }) {
  const columns = compact ? 18 : 34
  const rows = compact ? 5 : 9

  return (
    <div className="flex shrink-0 scale-105 flex-wrap items-center justify-center gap-px bg-muted">
      {Array.from({ length: rows }).map((_, row) => (
        Array.from({ length: columns }).map((__, col) => (
          <div
            key={`${col}-${row}`}
            className="flex h-4 w-4 shrink-0 rounded-[2px] bg-background"
          />
        ))
      ))}
    </div>
  )
}
