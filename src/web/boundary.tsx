import { Component, type ReactNode } from "react";

export class PageBoundary extends Component<{ fallback: ReactNode; children: ReactNode; resetKey: string }, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; key: string }) {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
