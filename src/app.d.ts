declare global {
  namespace App {
    interface Locals {
      user: { id: number; username: string; email: string } | null
    }
    interface PageState {}
    interface Platform {}
    interface Session {}
  }
}

export {}
