import { Component, type ReactNode } from 'react'
import { captureMobileError } from '../analytics/mobileCrashChannel'

type Props = { children: ReactNode; fallback: ReactNode; resetKey?: number }

/** Keep vault recovery controls mounted when reading or rendering a workspace fails. */
export class WorkspaceLoadBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    captureMobileError(error, 'workspace')
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
