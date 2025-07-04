const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const passport = require('passport');
const redisService = require('../services/redis');

// Tüm işlemleri getir
router.get('/', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    // Önbellekten verileri al
    const cachedTransactions = await redisService.getCachedTransactions(req.user._id);
    if (cachedTransactions) {
      console.log('İşlemler önbellekten alındı');
      return res.json(cachedTransactions);
    }

    // Önbellekte yoksa veya hata varsa veritabanından al
    const transactions = await Transaction.find({ userId: req.user._id })
      .sort({ date: -1 });
    
    // Verileri önbelleğe kaydet (hata olsa bile devam et)
    try {
      await redisService.cacheTransactions(req.user._id, transactions);
      console.log('İşlemler veritabanından alındı ve önbelleğe kaydedildi');
    } catch (cacheError) {
      console.error('Önbellekleme hatası:', cacheError);
      // Önbellekleme hatası olsa bile verileri döndür
    }
    
    res.json(transactions);
  } catch (error) {
    console.error('İşlem getirme hatası:', error);
    res.status(500).json({ message: 'İşlemler yüklenirken bir hata oluştu' });
  }
});

// İşlem özeti getir
router.get('/summary', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    // Önbellekten aylık toplamları al
    const cachedTotals = await redisService.getCachedMonthlyTotals(req.user._id);
    if (cachedTotals) {
      console.log('Aylık toplamlar önbellekten alındı');
      return res.json(cachedTotals);
    }

    // Önbellekte yoksa veya hata varsa veritabanından hesapla
    const transactions = await Transaction.find({ userId: req.user._id });
    
    const totalIncome = transactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = transactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    const netBalance = totalIncome - totalExpense;
    
    const summary = {
      totalIncome,
      totalExpense,
      netBalance
    };

    // Toplamları önbelleğe kaydet (hata olsa bile devam et)
    try {
      await redisService.cacheMonthlyTotals(req.user._id, summary);
      console.log('Aylık toplamlar hesaplandı ve önbelleğe kaydedildi');
    } catch (cacheError) {
      console.error('Önbellekleme hatası:', cacheError);
      // Önbellekleme hatası olsa bile verileri döndür
    }
    
    res.json(summary);
  } catch (error) {
    console.error('Özet getirme hatası:', error);
    res.status(500).json({ message: 'İşlem özeti yüklenirken bir hata oluştu' });
  }
});

// Yeni işlem ekle
router.post('/', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const transaction = new Transaction({
      userId: req.user._id,
      type: req.body.type,
      amount: req.body.amount,
      category: req.body.category,
      description: req.body.description,
      date: req.body.date || new Date()
    });

    const newTransaction = await transaction.save();
    
    // Önbelleği temizle (hata olsa bile devam et)
    try {
      await redisService.invalidateTransactionsCache(req.user._id);
      await redisService.invalidateMonthlyTotalsCache(req.user._id);
      console.log('Yeni işlem eklendi, önbellek temizlendi');
    } catch (cacheError) {
      console.error('Önbellek temizleme hatası:', cacheError);
      // Önbellek temizleme hatası olsa bile işlemi tamamla
    }
    
    res.status(201).json(newTransaction);
  } catch (error) {
    console.error('İşlem ekleme hatası:', error);
    res.status(400).json({ message: 'İşlem eklenirken bir hata oluştu' });
  }
});

// İşlem güncelle
router.put('/:id', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const transaction = await Transaction.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      {
        type: req.body.type,
        amount: req.body.amount,
        description: req.body.description,
        date: req.body.date
      },
      { new: true }
    );
    
    if (!transaction) {
      return res.status(404).json({ message: 'İşlem bulunamadı' });
    }
    
    // Önbelleği temizle (hata olsa bile devam et)
    try {
      await redisService.invalidateTransactionsCache(req.user._id);
      await redisService.invalidateMonthlyTotalsCache(req.user._id);
      console.log('İşlem güncellendi, önbellek temizlendi');
    } catch (cacheError) {
      console.error('Önbellek temizleme hatası:', cacheError);
      // Önbellek temizleme hatası olsa bile işlemi tamamla
    }
    
    res.json(transaction);
  } catch (error) {
    console.error('İşlem güncelleme hatası:', error);
    res.status(400).json({ message: 'İşlem güncellenirken bir hata oluştu' });
  }
});

// İşlem sil
router.delete('/:id', passport.authenticate('jwt', { session: false }), async (req, res) => {
  try {
    const transaction = await Transaction.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!transaction) {
      return res.status(404).json({ message: 'İşlem bulunamadı' });
    }

    // Önbelleği temizle (hata olsa bile devam et)
    try {
      await redisService.invalidateTransactionsCache(req.user._id);
      await redisService.invalidateMonthlyTotalsCache(req.user._id);
      console.log('İşlem silindi, önbellek temizlendi');
    } catch (cacheError) {
      console.error('Önbellek temizleme hatası:', cacheError);
      // Önbellek temizleme hatası olsa bile işlemi tamamla
    }

    res.json({ message: 'İşlem silindi' });
  } catch (error) {
    console.error('İşlem silme hatası:', error);
    res.status(500).json({ message: 'İşlem silinirken bir hata oluştu' });
  }
});

module.exports = router; 