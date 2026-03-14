import React, { useState, useRef, useCallback } from 'react';
import AgentPanel from './AgentPanel';

interface Props {
  onClose: () => void;
  onAttach: () => void;
}

export default function FloatingAgentPanel({ onClose, onAttach }: Props) {
  const [position, setPosition] = useState({ x: 100, y: 80 });
  const [size, setSize] = useState({ width: 520, height: 600 });
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: position.x, startPosY: position.y };
    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPosition({
        x: Math.max(0, dragRef.current.startPosX + (ev.clientX - dragRef.current.startX)),
        y: Math.max(0, dragRef.current.startPosY + (ev.clientY - dragRef.current.startY)),
      });
    };
    const onMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [position]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.width;
    const startH = size.height;
    const onMouseMove = (ev: MouseEvent) => {
      setSize({
        width: Math.max(380, startW + (ev.clientX - startX)),
        height: Math.max(400, startH + (ev.clientY - startY)),
      });
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [size]);

  return (
    <div
      className="fixed z-50 rounded-lg shadow-2xl shadow-black/50 border border-pb-border overflow-hidden flex flex-col"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
    >
      {/* Drag handle bar */}
      <div
        className="h-8 bg-pb-surface flex items-center justify-between px-3 cursor-move select-none border-b border-pb-border"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs">🤖</span>
          <span className="text-[10px] font-semibold text-pb-text">ProxyBoy AI</span>
          <span className="text-[9px] text-pb-text-dim bg-pb-bg px-1.5 py-0.5 rounded">floating</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onAttach}
            className="text-pb-text-dim hover:text-pb-text text-xs px-1"
            title="Dock panel"
          >
            📌
          </button>
          <button
            onClick={onClose}
            className="text-pb-text-dim hover:text-pb-text text-sm px-1"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <AgentPanel onClose={onClose} onDetach={() => {}} isDetached={true} />
      </div>
      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
        onMouseDown={handleResizeStart}
      >
        <svg className="w-3 h-3 text-pb-text-dim absolute bottom-0.5 right-0.5" viewBox="0 0 12 12">
          <path d="M11 1v10H1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 5v6H5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
}
