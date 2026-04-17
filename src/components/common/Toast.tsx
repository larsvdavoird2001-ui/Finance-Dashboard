import { useToast } from '../../hooks/useToast'
interface Props { toasts: ReturnType<typeof useToast>['toasts'] }
export function Toast({ toasts }: Props) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>)}
    </div>
  )
}
