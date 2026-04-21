import { useState } from 'react';
import { Upload, KeyRound, AlertTriangle, Loader2 } from 'lucide-react';

interface ProjectUploadWizardProps {
  onSuccess: () => void;
  isClosable?: boolean;
  onClose?: () => void;
}

export function ProjectUploadWizard({ onSuccess, isClosable = false, onClose }: ProjectUploadWizardProps) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a .knxproj file.');
      return;
    }
    if (!file.name.endsWith('.knxproj')) {
      setError('File must be a .knxproj file.');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('password', password);
    
    try {
      const response = await fetch('/api/project/upload', {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.detail || 'Upload failed');
      }
      
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred during upload.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, 
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(10, 10, 15, 0.85)', backdropFilter: 'blur(12px)',
      zIndex: 1000, padding: '2rem'
    }}>
      <div className="glass-card" style={{ 
        width: '100%', maxWidth: 500, padding: '2.5rem',
        display: 'flex', flexDirection: 'column', gap: '1.5rem',
        position: 'relative', overflow: 'hidden'
      }}>
        {/* Glow effect */}
        <div style={{
          position: 'absolute', top: '-50%', left: '-50%', width: '200%', height: '200%',
          background: 'radial-gradient(circle at center, rgba(99,102,241,0.15) 0%, transparent 60%)',
          pointerEvents: 'none', zIndex: 0
        }} />
        
        {isClosable && onClose && (
          <button 
            onClick={onClose}
            style={{
              position: 'absolute', top: '1rem', right: '1rem',
              background: 'transparent', border: 'none', color: 'var(--text-dim)',
              cursor: 'pointer', zIndex: 10
            }}
          >
            ✕
          </button>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', zIndex: 1 }}>
          <img src="/logo.svg" alt="Spectrum KNX" style={{ width: 32, height: 32 }} />
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Project Setup</h2>
        </div>
        
        <p style={{ color: 'var(--text-dim)', lineHeight: 1.6, zIndex: 1 }}>
          It looks like you haven't provided a KNX project via environment variables. 
          Please upload your ETS Project file (.knxproj) and password below to enable monitoring and analysis.
        </p>

        {error && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
            padding: '1rem', background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px',
            color: '#fca5a5', fontSize: '0.9rem', zIndex: 1
          }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', zIndex: 1 }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Upload size={16} /> ETS Project File
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="file"
                accept=".knxproj"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: '8px',
                  background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)',
                  color: 'var(--text-main)', fontSize: '0.9rem',
                  cursor: 'pointer'
                }}
                disabled={isLoading}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <KeyRound size={16} /> Project Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter ETS project password"
              className="glass-input"
              style={{ padding: '0.75rem', width: '100%' }}
              disabled={isLoading}
            />
          </div>

          <button
            type="submit"
            disabled={!file || isLoading}
            style={{
              padding: '0.85rem', borderRadius: '8px', border: 'none',
              background: isLoading || !file ? 'rgba(99,102,241,0.5)' : 'var(--accent-primary)',
              color: 'white', fontWeight: 600, fontSize: '1rem',
              cursor: isLoading || !file ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              transition: 'background 0.2s', marginTop: '0.5rem'
            }}
          >
            {isLoading ? (
              <>
                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                Applying Project...
              </>
            ) : (
              'Upload & Start'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
