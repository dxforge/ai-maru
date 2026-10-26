import type { JobView } from '../../../shared/job'

/**
 * main 에 job 전체를 물어 `set` 으로 넣고, 그 뒤 main 이 보내는 목록도 넣는다. 묻는 동안 push 가 한 번이라도 왔으면 답은
 * 버린다. main 은 표가 바뀔 때마다 전체를 push 하므로, 답을 버려도 마지막 push 가 지금 표다.
 */
export function syncJobs(
  set: (jobs: JobView[]) => void,
  api: { onJobs(cb: (jobs: JobView[]) => void): void; jobs(): Promise<JobView[]> }
): void {
  let pushed = false
  api.onJobs((jobs) => {
    pushed = true
    set(jobs)
  })
  void api.jobs().then((jobs) => {
    if (!pushed) set(jobs)
  })
}
