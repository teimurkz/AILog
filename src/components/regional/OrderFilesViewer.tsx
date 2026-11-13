import React from 'react';
import { AlertTriangle, Download, ExternalLink, File, FileSpreadsheet, Image as ImageIcon } from 'lucide-react';
import { attachmentKind, dataUrlToBlob, type OrderAttachment } from '../../../shared/order-files';
import type { RegionalTexts } from './regional-i18n';

interface OrderFilesViewerProps {
  files: OrderAttachment[];
  selected: number;
  onSelect: (index: number) => void;
  texts: RegionalTexts;
}

/** A browser URL for the file: blob URLs open large PDFs that data URLs choke on; links stay as they are. */
function useFileUrl(file: OrderAttachment | undefined) {
  const [url, setUrl] = React.useState('');
  React.useEffect(() => {
    if (!file?.fileData) { setUrl(''); return; }
    if (!file.fileData.startsWith('data:')) { setUrl(file.fileData); return; }
    let blob: Blob | null = null;
    try { blob = dataUrlToBlob(file.fileData); } catch (error) { console.error('Attachment decode failed:', file.fileName, error); }
    if (!blob) { setUrl(file.fileData); return; }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file?.fileData, file?.fileName]);
  return url;
}

const KindIcon = ({ file }: { file: OrderAttachment }) => {
  const kind = attachmentKind(file);
  if (file.missing) return <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500" />;
  if (kind === 'image') return <ImageIcon className="w-3.5 h-3.5 shrink-0 text-purple-500" />;
  if (kind === 'excel') return <FileSpreadsheet className="w-3.5 h-3.5 shrink-0 text-emerald-600" />;
  return <File className="w-3.5 h-3.5 shrink-0 text-purple-500" />;
};

/** Every file attached to the order: one tab per waybill, the chosen one shown below. */
export const OrderFilesViewer = ({ files, selected, onSelect, texts }: OrderFilesViewerProps) => {
  const o = texts.orders;
  const index = Math.min(Math.max(selected, 0), files.length - 1);
  const file = files[index];
  const url = useFileUrl(file);
  const kind = file ? attachmentKind(file) : 'other';
  const name = file ? file.fileName || `${file.invoiceNumber || index + 1}${kind === 'pdf' ? '.pdf' : ''}` : '';

  React.useEffect(() => {
    if (files.length < 2) return;
    // Arrow keys flip through the waybills, like pages.
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      if (event.key === 'ArrowRight') onSelect((index + 1) % files.length);
      if (event.key === 'ArrowLeft') onSelect((index - 1 + files.length) % files.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [files.length, index, onSelect]);

  if (!file) return null;

  return (
    <div className="space-y-3">
      {files.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={o.filesTab(files.length)}>
          {files.map((item, i) => (
            <button
              key={`${i}-${item.fileName}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => onSelect(i)}
              title={item.fileName}
              className={`max-w-[16rem] px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors ${i === index
                ? 'bg-purple-600 border-purple-600 text-white'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-purple-400'}`}
            >
              <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center shrink-0 ${i === index ? 'bg-white text-purple-700' : 'bg-purple-100 text-purple-700'}`}>{i + 1}</span>
              {i !== index && <KindIcon file={item} />}
              <span className="truncate">{item.invoiceNumber || item.fileName}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 min-w-0 text-slate-600 dark:text-slate-300">
          <KindIcon file={file} />
          <span className="font-bold truncate">{file.fileName || file.invoiceNumber}</span>
          {file.fileSize && <span className="text-slate-400 shrink-0">({file.fileSize})</span>}
          {files.length > 1 && <span className="text-slate-400 shrink-0">· {o.fileOf(index + 1, files.length)}</span>}
        </div>
        {url && (
          <div className="flex items-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold rounded-xl transition-colors flex items-center gap-1.5"
              title={o.openInTabTitle}
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
              <span className="hidden sm:inline">{o.inNewTab}</span>
            </a>
            <a
              href={url}
              download={name}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-sm"
              title={o.downloadFileTitle}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{texts.common.download}</span>
            </a>
          </div>
        )}
      </div>

      <div className="w-full bg-slate-900/90 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center min-h-[450px]">
        {file.missing ? (
          <p className="p-6 max-w-md text-center text-sm text-amber-200">{o.fileMissing(file.fileName)}</p>
        ) : !url ? null : kind === 'image' ? (
          <div className="p-4 flex items-center justify-center w-full min-h-[500px]">
            <img src={url} alt={name} className="max-h-[70vh] w-auto max-w-full object-contain rounded-xl shadow-2xl border border-slate-700" />
          </div>
        ) : kind === 'pdf' ? (
          <iframe key={url} src={url} title={name} className="w-full h-[72vh] min-h-[500px] border-none bg-slate-900" />
        ) : (
          <div className="p-6 max-w-md text-center space-y-3">
            {kind === 'excel' ? <FileSpreadsheet className="w-10 h-10 mx-auto text-emerald-400" /> : <File className="w-10 h-10 mx-auto text-slate-400" />}
            <p className="text-sm text-slate-200">{o.noPreview}</p>
            <a href={url} download={name} className="inline-flex px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> {texts.common.download}
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
