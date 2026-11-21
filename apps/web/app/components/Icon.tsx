/* 아이콘: 1.5px 선, 16px 그리드 */
export const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export const I = {
  search: "M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5",
  clip: "M10.5 4.5 5.6 9.4a1.5 1.5 0 0 0 2.1 2.1l5-5a3 3 0 0 0-4.2-4.2l-5 5a4.5 4.5 0 0 0 6.4 6.4L14 9.6",
  reply: "M6 3.5 2 7.5l4 4M2.5 7.5H10a4 4 0 0 1 4 4v1",
  check: "M2.5 8.5 6 12l7.5-8",
  redo: "M13.5 3v3.5H10M13.2 6.5A5.5 5.5 0 1 0 13 10",
  sync: "M2.5 6.5a5.5 5.5 0 0 1 10-2.5M13.5 2.5V5H11M13.5 9.5a5.5 5.5 0 0 1-10 2.5M2.5 13.5V11H5",
  link: "M6.5 9.5 9.5 6.5M7 4l1-1a3 3 0 0 1 4.2 4.2l-1 1M9 12l-1 1A3 3 0 0 1 3.8 8.8l1-1",
  moon: "M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z",
  sun: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1",
  copy: "M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3",
  x: "M4 4l8 8M12 4l-8 8",
};
