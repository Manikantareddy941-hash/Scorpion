import { ReactNode } from "react"
import { Asterisk } from "lucide-react"

interface ModernAuthLayoutProps {
    children: ReactNode
    heading?: string
    subtext?: string
}

export default function ModernAuthLayout({
    children,
    heading = "Get access to your personal hub",
    subtext = "Clarity. Security. Productivity.",
}: ModernAuthLayoutProps) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-neutral-950 px-4">
            <div className="w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden bg-white dark:bg-neutral-900 grid md:grid-cols-2">

                {/* Left Gradient Panel */}
                <div className="hidden md:flex flex-col justify-between p-10 bg-gradient-to-br from-blue-600 via-purple-600 to-pink-400 text-white">

                    <Asterisk className="w-8 h-8 opacity-90" />

                    <div>
                        <p className="text-sm opacity-80 mb-2">
                            You can easily
                        </p>
                        <h2 className="text-3xl font-bold leading-snug">
                            {heading}
                        </h2>
                        <p className="mt-3 text-sm opacity-80">
                            {subtext}
                        </p>
                    </div>
                </div>

                {/* Right Form Panel */}
                <div className="p-8 md:p-12 flex flex-col justify-center">
                    {children}
                </div>

            </div>
        </div>
    )
}
