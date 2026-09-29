import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../infra/prisma/prisma.service';
import { PrivyAuthService } from '../auth/privy/privy-auth.service';
import { LEARNING_LESSONS } from './learning.catalog';

@Injectable()
export class LearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly privy: PrivyAuthService,
  ) {}

  // Match wallet-login's canonical account, never a user ID supplied by the app.
  async resolveUserId(privyUserId: string) {
    const addresses = await this.privy.getStellarWalletAddresses(privyUserId);
    const wallet = await this.prisma.walletAccount.findFirst({
      where: { stellarAddress: { in: addresses }, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    if (!wallet)
      throw new ForbiddenException('Complete wallet registration first');
    return wallet.userId;
  }

  catalog() {
    return LEARNING_LESSONS.map(({ questions, ...lesson }) => ({
      ...lesson,
      xp: questions.reduce((sum, question) => sum + question.points, 0),
      // The answer key and feedback are returned only after an answer.
      questions: questions.map(({ id, question, options, points }) => ({
        id,
        question,
        options,
        points,
      })),
    }));
  }

  access(assetSymbol: string, points: number) {
    const symbol =
      assetSymbol.toUpperCase() === 'NATIVE'
        ? 'XLM'
        : assetSymbol.toUpperCase();
    const thresholds: Record<string, number> = {
      USDC: 0,
      EURC: this.config.get<number>('EDUCATION_EURC_POINTS', 90),
      XLM: this.config.get<number>('EDUCATION_XLM_POINTS', 150),
    };
    const requiredPoints = thresholds[symbol] ?? null;
    const unlocked = requiredPoints !== null && points >= requiredPoints;
    return {
      requiredPoints,
      points,
      unlocked,
      pointsRemaining:
        requiredPoints === null ? null : Math.max(0, requiredPoints - points),
    };
  }

  async progress(userId: string) {
    const rewards = await this.prisma.learningReward.findMany({
      where: { userId },
      select: { questionId: true, points: true },
    });
    const points = rewards.reduce((sum, reward) => sum + reward.points, 0);
    const answered = new Set(rewards.map((reward) => reward.questionId));
    const completedLessonIds = LEARNING_LESSONS.filter((lesson) =>
      lesson.questions.every((q) => answered.has(q.id)),
    ).map((lesson) => lesson.id);
    return {
      points,
      completedQuestionIds: [...answered],
      completedLessonIds,
      vaultAccess: Object.fromEntries(
        ['USDC', 'EURC', 'XLM'].map((symbol) => [
          symbol,
          this.access(symbol, points),
        ]),
      ),
    };
  }

  async answer(
    userId: string,
    lessonId: number,
    questionId: string,
    optionId: string,
    version: number,
  ) {
    const lesson = LEARNING_LESSONS.find((item) => item.id === lessonId);
    const question = lesson?.questions.find((item) => item.id === questionId);
    if (!lesson || !question) throw new NotFoundException('Question not found');
    if (lesson.version !== version)
      throw new BadRequestException('Lesson changed. Reload before answering.');
    if (!question.options.some((option) => option.id === optionId))
      throw new BadRequestException('Invalid option');
    const before = await this.progress(userId);
    if (
      LEARNING_LESSONS.some(
        (item) =>
          item.id < lessonId && !before.completedLessonIds.includes(item.id),
      )
    ) {
      throw new ForbiddenException('Complete the previous lessons first');
    }
    const correct = optionId === question.correctOptionId;
    let awardedPoints = 0;
    if (correct) {
      // INSERT ON CONFLICT DO NOTHING: concurrent requests can award only once.
      const result = await this.prisma.learningReward.createMany({
        data: [
          {
            userId,
            questionId,
            lessonId,
            contentVersion: version,
            points: question.points,
          },
        ],
        skipDuplicates: true,
      });
      awardedPoints = result.count * question.points;
    }
    return {
      correct,
      explanation: question.explanation,
      awardedPoints,
      progress: await this.progress(userId),
    };
  }

  async assertDepositAccess(
    userId: string,
    vault: { id: string; isActive: boolean; assetSymbol: string },
  ) {
    const allowed = this.config
      .get<string>('ALLOWED_VAULT_IDS', '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const disabled = this.config
      .get<string>('DISABLED_DEPOSIT_VAULT_IDS', '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (
      !vault.isActive ||
      (allowed.length > 0 && !allowed.includes(vault.id)) ||
      disabled.includes(vault.id)
    ) {
      throw new ForbiddenException('New deposits are disabled for this vault');
    }
    // USDC always has zero educational prerequisites, even for a new account.
    if (vault.assetSymbol.toUpperCase() === 'USDC') return;
    const { points } = await this.progress(userId);
    const access = this.access(vault.assetSymbol, points);
    if (!access.unlocked)
      throw new ForbiddenException({
        message: 'Complete the learning trail to unlock this vault',
        code: 'VAULT_EDUCATION_LOCKED',
        ...access,
      });
  }
}
