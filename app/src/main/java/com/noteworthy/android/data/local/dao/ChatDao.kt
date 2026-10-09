package com.noteworthy.android.data.local.dao

import androidx.room.*
import com.noteworthy.android.data.local.entity.ChatEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ChatDao {
    @Query("SELECT * FROM chats WHERE (:profile = 'combined' OR profile = :profile) AND ((:noteId IS NULL AND noteId IS NULL) OR noteId = :noteId) ORDER BY updatedAt DESC")
    fun getChats(profile: String, noteId: String?): Flow<List<ChatEntity>>

    @Query("SELECT * FROM chats WHERE id = :id LIMIT 1")
    suspend fun getChatById(id: String): ChatEntity?

    @Query("SELECT * FROM chats WHERE id = :id")
    fun observeChatById(id: String): Flow<ChatEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertChat(chat: ChatEntity)

    @Update
    suspend fun updateChat(chat: ChatEntity)
}
