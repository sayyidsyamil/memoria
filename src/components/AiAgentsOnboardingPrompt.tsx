import {
	ArrowUpRight,
	CaretDown,
} from "@phosphor-icons/react";
import {
	AI_AGENT_DEFINITIONS,
	type AiAgentDefinition,
	type AiAgentsStatus,
	getAiAgentAvailability,
	getAiAgentDefinition,
	hasAnyInstalledAiAgent,
	isAiAgentsStatusChecking,
} from "../lib/aiAgents";
import { type AppLocale, translate } from "../lib/i18n";
import { openExternalUrl } from "../utils/url";
import { AiAgentIcon } from "./AiAgentIcon";
import { OnboardingShell } from "./OnboardingShell";
import { Button } from "./ui/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "./ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface AiAgentsOnboardingPromptProps {
	statuses: AiAgentsStatus;
	onContinue: () => void;
	locale?: AppLocale;
}

interface InfoPanelProps {
	description: string;
	testId?: string;
	textAlign?: "left" | "center";
	title: string;
}

function getPromptCopy(statuses: AiAgentsStatus, locale: AppLocale) {
	if (isAiAgentsStatusChecking(statuses)) {
		return {
			description: translate(locale, "onboarding.ai.checkingDescription"),
			title: translate(locale, "onboarding.ai.checkingTitle"),
		};
	}

	if (!hasAnyInstalledAiAgent(statuses)) {
		return {
			description: translate(locale, "onboarding.ai.missingDescription"),
			title: translate(locale, "onboarding.ai.missingTitle"),
		};
	}

	return {
		description: translate(locale, "onboarding.ai.readyDescription"),
		title: translate(locale, "onboarding.ai.readyTitle"),
	};
}

function installedAgentDefinitions(
	statuses: AiAgentsStatus,
): AiAgentDefinition[] {
	return AI_AGENT_DEFINITIONS.filter((definition) => {
		return (
			getAiAgentAvailability(statuses, definition.id).status === "installed"
		);
	});
}

function InfoPanel({
	description,
	testId,
	textAlign = "left",
	title,
}: InfoPanelProps) {
	const textAlignClass = textAlign === "center" ? "text-center" : "text-left";
	return (
		<div
			className={`py-2 ${textAlignClass}`}
			data-testid={testId}
		>
			<div className="text-sm font-medium text-foreground">{title}</div>
			<p className="mt-1 text-pretty text-sm leading-6 text-foreground/80">
				{description}
			</p>
		</div>
	);
}

function DetectedAgentsList({
	agents,
	locale,
	statuses,
}: {
	agents: AiAgentDefinition[];
	locale: AppLocale;
	statuses: AiAgentsStatus;
}) {
	return (
		<div className="space-y-2" data-testid="ai-agents-onboarding-detected-list">
			<div className="text-sm font-medium text-foreground">
				{translate(locale, "onboarding.ai.detectedHeader")}
			</div>
			{agents.map((definition) => {
				const status = getAiAgentAvailability(statuses, definition.id);
				return (
					<div
						key={definition.id}
						className="flex items-center justify-between gap-3 py-3 text-sm"
					>
						<div className="flex min-w-0 items-center gap-3 text-left">
							<AiAgentIcon agent={definition.id} size={18} />
							<div className="min-w-0">
								<div className="font-medium text-foreground">
									{definition.label}
								</div>
								<div className="text-sm text-foreground/80">
									{status.version
										? translate(locale, "onboarding.ai.installedVersion", {
												version: status.version,
											})
										: translate(locale, "onboarding.ai.installed")}
								</div>
							</div>
						</div>
						<span className="text-sm text-foreground/80">
							{translate(locale, "onboarding.ai.installedBadge")}
						</span>
					</div>
				);
			})}
		</div>
	);
}

function SupportedAgentsMenu({ locale }: { locale: AppLocale }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="outline"
					data-testid="ai-agents-onboarding-supported-menu"
				>
					{translate(locale, "onboarding.ai.supportedAgents")}
					<CaretDown className="size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="center" className="min-w-[240px]">
				{AI_AGENT_DEFINITIONS.map((definition) => (
					<DropdownMenuItem
						key={definition.id}
						className="gap-2"
						onSelect={() =>
							void openExternalUrl(
								getAiAgentDefinition(definition.id).installUrl,
							)
						}
						data-testid={`ai-agents-onboarding-install-${definition.id}`}
					>
						<AiAgentIcon agent={definition.id} size={16} />
						<span className="min-w-0 flex-1">{definition.label}</span>
						<ArrowUpRight className="size-4" />
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function AiSetupSummary({ locale }: { locale: AppLocale }) {
	return (
		<InfoPanel
			title={translate(locale, "onboarding.ai.otherOptionsTitle")}
			description={translate(locale, "onboarding.ai.otherOptionsDescription")}
		/>
	);
}

function CheckingAgents({ locale }: { locale: AppLocale }) {
	return (
		<InfoPanel
			title={translate(locale, "onboarding.ai.checkingLocalTitle")}
			description={translate(locale, "onboarding.ai.checkingLocalDescription")}
			textAlign="left"
			testId="ai-agents-onboarding-checking"
		/>
	);
}

function AiAgentsOnboardingDetails({
	checking,
	installedAgents,
	locale,
	statuses,
}: {
	checking: boolean;
	installedAgents: AiAgentDefinition[];
	locale: AppLocale;
	statuses: AiAgentsStatus;
}) {
	return (
		<CardContent
			className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain"
			data-testid="ai-agents-onboarding-scroll"
		>
			{checking ? <CheckingAgents locale={locale} /> : null}
			{!checking && installedAgents.length > 0 ? (
				<DetectedAgentsList
					agents={installedAgents}
					statuses={statuses}
					locale={locale}
				/>
			) : null}
			<AiSetupSummary locale={locale} />
		</CardContent>
	);
}

function AiAgentsOnboardingHeader({
	copy,
}: {
	copy: ReturnType<typeof getPromptCopy>;
}) {
	return (
		<CardHeader className="shrink-0 gap-3 text-left">
			<div className="space-y-2">
				<CardTitle className="text-2xl">{copy.title}</CardTitle>
				<p
					className="text-pretty text-sm leading-6 text-foreground/80"
					data-testid="ai-agents-onboarding-description"
				>
					{copy.description}
				</p>
			</div>
		</CardHeader>
	);
}

export function AiAgentsOnboardingPrompt({
	statuses,
	onContinue,
	locale = "en",
}: AiAgentsOnboardingPromptProps) {
	const copy = getPromptCopy(statuses, locale);
	const checking = isAiAgentsStatusChecking(statuses);
	const installedAgents = installedAgentDefinitions(statuses);

	return (
		<OnboardingShell
			className="bg-sidebar px-6 py-10"
			contentClassName="w-full max-w-lg"
			testId="ai-agents-onboarding-screen"
		>
			<Card
				className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden border-0 bg-background shadow-none"
				data-testid="ai-agents-onboarding-card"
			>
				<AiAgentsOnboardingHeader copy={copy} />

				<AiAgentsOnboardingDetails
					checking={checking}
					installedAgents={installedAgents}
					locale={locale}
					statuses={statuses}
				/>

				<CardFooter className="shrink-0 flex-wrap justify-between gap-3">
					<SupportedAgentsMenu locale={locale} />
					<div data-testid="ai-agents-onboarding-continue">
						<Button type="button" onClick={onContinue}>
							{hasAnyInstalledAiAgent(statuses)
								? translate(locale, "onboarding.ai.continue")
								: translate(locale, "onboarding.ai.setUpLater")}
						</Button>
					</div>
				</CardFooter>
			</Card>
		</OnboardingShell>
	);
}
