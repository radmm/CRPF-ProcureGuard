/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { Upload, File, X, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface FileUploaderProps {
  onFilesSelected: (files: { name: string; type: string; data: string }[]) => void;
  accept?: string;
  multiple?: boolean;
  label?: string;
}

export const FileUploader: React.FC<FileUploaderProps> = ({ 
  onFilesSelected, 
  accept = "image/*,application/pdf", 
  multiple = true,
  label = "Click or drag documents to upload"
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isReading, setIsReading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileRead = async (files: File[]) => {
    setIsReading(true);
    const results = await Promise.all(
      files.map(file => new Promise<{ name: string; type: string; data: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve({
            name: file.name,
            type: file.type,
            data: base64
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }))
    );
    onFilesSelected(results);
    setIsReading(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    setSelectedFiles(prev => multiple ? [...prev, ...files] : [files[0]]);
    handleFileRead(multiple ? [...selectedFiles, ...files] : [files[0]]);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setSelectedFiles(prev => multiple ? [...prev, ...files] : [files[0]]);
      handleFileRead(multiple ? [...selectedFiles, ...files] : [files[0]]);
    }
  };

  const removeFile = (index: number) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(newFiles);
    // Note: In a real app, you'd want to update the parent state too if it relies on this index
  };

  return (
    <div className="w-full">
      <div
        className={cn(
          "relative border-2 border-dashed rounded-xl p-8 transition-all duration-200 flex flex-col items-center justify-center cursor-pointer",
          isDragging ? "border-blue-500 bg-blue-50/50" : "border-slate-300 hover:border-blue-400 bg-slate-50/50",
          isReading && "opacity-50 pointer-events-none"
        )}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept={accept}
          multiple={multiple}
          onChange={onFileChange}
        />
        
        {isReading ? (
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
        ) : (
          <Upload className="w-10 h-10 text-slate-400 mb-4" />
        )}
        
        <p className="text-slate-600 font-medium text-center">{label}</p>
        <p className="text-slate-400 text-sm mt-1">Supports scanned images, PDFs, and typed documents</p>
      </div>

      <AnimatePresence>
        {selectedFiles.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 space-y-2"
          >
            {selectedFiles.map((file, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded text-blue-600">
                    <File size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-700 truncate max-w-[200px]">{file.name}</p>
                    <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                  className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-red-500 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
