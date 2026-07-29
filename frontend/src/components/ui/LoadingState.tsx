interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = "正在读取机房数据" }: LoadingStateProps) {
  return (
    <div className="loading-state">
      <span className="loading-mark" />
      <p>{label}</p>
    </div>
  );
}
