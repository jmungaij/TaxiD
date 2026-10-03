import { useState } from "react";
import { Upload, FileCheck, X, Camera, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface DocumentUploadFieldProps {
  label: string;
  description?: string;
  required?: boolean;
  onUpload?: (file: File) => void;
  status?: "pending" | "uploaded" | "verified" | "rejected";
  error?: string;
}

export function DocumentUploadField({
  label,
  description,
  required,
  status = "pending",
  error,
}: DocumentUploadFieldProps) {
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold flex items-center gap-1.5">
          {label}
          {required && <span className="text-destructive">*</span>}
        </Label>
        {status === "uploaded" && (
          <Badge variant="secondary" className="bg-success/10 text-success border-success/20 text-[10px] uppercase font-bold">
            <FileCheck className="h-3 w-3 mr-1" /> Ready
          </Badge>
        )}
      </div>
      
      {description && (
        <p className="text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          {description}
        </p>
      )}

      <div 
        className={`relative border-2 border-dashed rounded-xl p-4 transition-all hover:bg-muted/50 cursor-pointer ${
          fileName ? "border-primary/50 bg-primary/5" : "border-border"
        } ${error ? "border-destructive/50" : ""}`}
      >
        <input
          type="file"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onChange={handleFileChange}
          accept="image/*,.pdf"
        />
        
        {fileName ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <FileCheck className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate max-w-[180px]">{fileName}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Document captured</p>
              </div>
            </div>
            <Button 
              type="button" 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.preventDefault();
                setFileName(null);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-2 text-center">
            <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center mb-2">
              <Camera className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Tap to upload or take a photo</p>
            <p className="text-[10px] text-muted-foreground mt-1">PNG, JPG or PDF up to 10MB</p>
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-destructive font-medium">{error}</p>}
    </div>
  );
}
