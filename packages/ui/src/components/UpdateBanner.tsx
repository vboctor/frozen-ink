import { useEffect, useState } from "react";

interface UpdateInfo {
  version: string;
  releaseNotes: string | null;
  releaseUrl: string;
}

interface FrozenInkApi {
  onUpdateAvailable?: (cb: (info: UpdateInfo) => void) => () => void;
  openReleasePage?: (url: string) => Promise<{ ok: boolean }>;
}

const DISMISS_KEY = "frozenink-update-dismissed";

export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const api = (window as unknown as { frozenink?: FrozenInkApi }).frozenink;
    if (!api?.onUpdateAvailable) return;
    return api.onUpdateAvailable((next) => {
      try {
        if (localStorage.getItem(DISMISS_KEY) === next.version) return;
      } catch {}
      setInfo(next);
    });
  }, []);

  if (!info) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, info.version); } catch {}
    setInfo(null);
  };

  const download = () => {
    const api = (window as unknown as { frozenink?: FrozenInkApi }).frozenink;
    api?.openReleasePage?.(info.releaseUrl).catch(() => {});
  };

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-text">
        Frozen Ink {info.version} is available.
      </span>
      <button className="update-banner-btn" onClick={download}>Download</button>
      <button className="update-banner-close" onClick={dismiss} aria-label="Dismiss update notice">×</button>
    </div>
  );
}
