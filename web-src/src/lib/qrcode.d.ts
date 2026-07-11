declare function qrcode(
  typeNumber: number,
  errorCorrectionLevel: string,
): {
  addData(data: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
};

export default qrcode;
