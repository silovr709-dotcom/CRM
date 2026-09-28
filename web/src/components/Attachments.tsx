import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { Attachment } from '../types';

function fmtSize(b: number) {
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' МБ';
  if (b > 1024) return Math.round(b / 1024) + ' КБ';
  return b + ' Б';
}

export default function Attachments({ taskId, projectId }: { taskId?: number; projectId?: number }) {
  const { toast } = useApp();
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = taskId ? `task_id=${taskId}` : `project_id=${projectId}`;

  async function load() {
    const list = await api.get<Attachment[]>(`/attachments?${query}`);
    setFiles(list);
  }
  useEffect(() => { load().catch(() => {}); }, [taskId, projectId]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast('Файл больше 15 МБ'); return; }
    setUploading(true);
    try {
      const data = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(',')[1]);
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
      await api.post('/attachments', {
        filename: file.name, mime: file.type || 'application/octet-stream', data,
        task_id: taskId ?? null, project_id: projectId ?? null,
      });
      toast('Файл загружен');
      await load();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove(id: number) {
    await api.del(`/attachments/${id}`);
    await load();
  }

  return (
    <div className="field">
      <label>Файлы</label>
      {files.map(f => (
        <div key={f.id} className="flex small mt8" style={{ justifyContent: 'space-between' }}>
          <a href={`/api/attachments/${f.id}/download`} target="_blank" rel="noreferrer"
            style={{ color: 'var(--accent-ink)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📎 {f.filename} <span className="muted">({fmtSize(f.size)})</span>
          </a>
          <button className="btn small ghost danger" onClick={() => remove(f.id)}>✕</button>
        </div>
      ))}
      <div className="mt8">
        <input ref={inputRef} type="file" style={{ display: 'none' }} onChange={onPick} />
        <button className="btn small" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? 'Загрузка…' : '+ Прикрепить файл'}
        </button>
      </div>
    </div>
  );
}
